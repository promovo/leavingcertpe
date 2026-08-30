import wixLocationFrontend from 'wix-location-frontend';

import {
  listMySchoolMembers,
  removeSchoolMember,
  setSchoolMemberRole
} from 'backend/resourceAccess.web';


$w.onReady(function () {

  $w('#adminBackToLibraryButton').onClick(function () {
    wixLocationFrontend.to('/resource-library');
  });

  // Copy button disabled for now to remove the code that caused the build error.
  $w('#copySchoolCodeButton').hide();
  $w('#copySchoolCodeButton').collapse();

  setupRepeater();

  loadSchoolAdmin();
});


function setupRepeater() {

  $w('#schoolMembersRepeater').onItemReady(function ($item, itemData) {

    var fullName =
      ((itemData.firstName || '') + ' ' + (itemData.lastName || '')).trim();


    $item('#memberName').text =
      fullName || 'School Member';


    $item('#memberEmail').text =
      itemData.email || '';


    $item('#memberYearGroup').text =
      itemData.yearGroup || '—';


    $item('#memberRoleDropdown').options = [
      {
        label: 'Student',
        value: 'STUDENT'
      },
      {
        label: 'Teacher',
        value: 'TEACHER'
      },
      {
        label: 'Administrator',
        value: 'ADMIN'
      }
    ];


    $item('#memberRoleDropdown').value =
      itemData.role || 'STUDENT';


    if (itemData.isPrimaryAdmin) {

      $item('#memberRoleDropdown').disable();

      $item('#removeMemberButton').hide();
      $item('#removeMemberButton').collapse();

    } else {

      $item('#memberRoleDropdown').enable();

      $item('#removeMemberButton').show();
      $item('#removeMemberButton').expand();

    }


    $item('#memberRoleDropdown').onChange(async function () {

      var previousRole =
        itemData.role || 'STUDENT';

      var newRole =
        $item('#memberRoleDropdown').value;


      hideError();

      $item('#memberRoleDropdown').disable();


      try {

        var result =
          await setSchoolMemberRole(
            itemData.memberId,
            newRole
          );


        if (!result || !result.ok) {

          $item('#memberRoleDropdown').value =
            previousRole;

          showActionError(
            result ? result.code : 'UNEXPECTED_ERROR'
          );

          return;

        }


        itemData.role =
          result.role || newRole;


      } catch (error) {

        console.error(
          'Role change failed:',
          error
        );


        $item('#memberRoleDropdown').value =
          previousRole;


        showError(
          'We could not change this member’s role. Please try again.'
        );


      } finally {

        if (!itemData.isPrimaryAdmin) {

          $item('#memberRoleDropdown').enable();

        }

      }

    });


    $item('#removeMemberButton').onClick(async function () {

      hideError();

      $item('#removeMemberButton').disable();


      try {

        var result =
          await removeSchoolMember(
            itemData.memberId
          );


        if (!result || !result.ok) {

          showActionError(
            result ? result.code : 'UNEXPECTED_ERROR'
          );

          return;

        }


        await loadSchoolAdmin();


      } catch (error) {

        console.error(
          'Remove member failed:',
          error
        );


        showError(
          'We could not remove this member. Please try again.'
        );


      } finally {

        $item('#removeMemberButton').enable();

      }

    });

  });

}


async function loadSchoolAdmin() {

  hideError();

  hideAdminContent();


  $w('#adminLoadingText').text =
    'Loading school administration…';


  showElement(
    '#adminLoadingText'
  );


  try {

    var result =
      await listMySchoolMembers();


    hideElement(
      '#adminLoadingText'
    );


    if (!result || !result.ok) {

      showAccessError(
        result ? result.code : 'UNEXPECTED_ERROR'
      );

      return;

    }


    $w('#adminSchoolName').text =
      result.schoolName || 'School';


    $w('#adminSchoolCode').text =
      result.schoolCode
        ? 'School code: ' + result.schoolCode
        : '';


    $w('#seatUsageText').text =
      'Active users: ' +
      (result.seatsUsed || 0) +
      ' of ' +
      (result.seatAllowance || 0);


    $w('#adminExpiryText').text =
      result.expiryDate
        ? 'Access expires: ' + formatDate(result.expiryDate)
        : '';


    var members =
      Array.isArray(result.members)
        ? result.members
        : [];


    $w('#schoolMembersRepeater').data =
      members.map(function (member) {

        return {

          _id: String(member.memberId),

          memberId: member.memberId,

          firstName:
            member.firstName || '',

          lastName:
            member.lastName || '',

          email:
            member.email || '',

          yearGroup:
            member.yearGroup || '',

          role:
            member.role || 'STUDENT',

          isPrimaryAdmin:
            Boolean(member.isPrimaryAdmin)

        };

      });


    showElement(
      '#adminSchoolName'
    );


    showElement(
      '#adminSchoolCode'
    );


    showElement(
      '#seatUsageText'
    );


    showElement(
      '#adminExpiryText'
    );


    showElement(
      '#schoolMembersHeading'
    );


    if (members.length === 0) {

      hideElement(
        '#schoolMembersRepeater'
      );


      $w('#noSchoolMembersText').text =
        'There are currently no active school members.';


      showElement(
        '#noSchoolMembersText'
      );


    } else {

      hideElement(
        '#noSchoolMembersText'
      );


      showElement(
        '#schoolMembersRepeater'
      );

    }


  } catch (error) {

    console.error(
      'School Admin load failed:',
      error
    );


    hideElement(
      '#adminLoadingText'
    );


    hideAdminContent();


    showError(
      'We could not load the School Admin area. Please try again.'
    );

  }

}


function showAccessError(code) {

  if (

    code === 'NO_ENTITLEMENT' ||

    code === 'SCHOOL_ADMIN_REQUIRED' ||

    code === 'INVALID_ACCESS_TYPE' ||

    code === 'ENTITLEMENT_INACTIVE' ||

    code === 'MEMBER_NOT_STARTED' ||

    code === 'MEMBER_EXPIRED' ||

    code === 'SCHOOL_INACTIVE' ||

    code === 'SCHOOL_NOT_STARTED' ||

    code === 'SCHOOL_EXPIRED'

  ) {

    showError(
      'This area is only available to School Administrators.'
    );

    return;

  }


  showError(
    'We could not complete this action. Please try again.'
  );

}


function showActionError(code) {

  if (
    code === 'PRIMARY_ADMIN_CANNOT_BE_REMOVED'
  ) {

    showError(
      'The primary School Administrator cannot be removed.'
    );

    return;

  }


  if (
    code === 'PRIMARY_ADMIN_MUST_REMAIN_ADMIN'
  ) {

    showError(
      'The primary School Administrator must remain an Administrator.'
    );

    return;

  }


  if (
    code === 'MEMBER_NOT_IN_SCHOOL'
  ) {

    showError(
      'This member is no longer part of your school.'
    );

    return;

  }


  if (
    code === 'INVALID_TARGET_MEMBER'
  ) {

    showError(
      'You cannot remove your own administrator account.'
    );

    return;

  }


  if (
    code === 'INVALID_ROLE_CHANGE'
  ) {

    showError(
      'That role change could not be completed.'
    );

    return;

  }


  showError(
    'We could not complete this action. Please try again.'
  );

}


function hideAdminContent() {

  hideElement(
    '#adminSchoolName'
  );


  hideElement(
    '#adminSchoolCode'
  );


  hideElement(
    '#copySchoolCodeButton'
  );


  hideElement(
    '#seatUsageText'
  );


  hideElement(
    '#adminExpiryText'
  );


  hideElement(
    '#schoolMembersHeading'
  );


  hideElement(
    '#schoolMembersRepeater'
  );


  hideElement(
    '#noSchoolMembersText'
  );

}


function showError(message) {

  $w('#adminErrorText').text =
    message;


  showElement(
    '#adminErrorText'
  );

}


function hideError() {

  hideElement(
    '#adminErrorText'
  );

}


function showElement(selector) {

  $w(selector).expand();

  $w(selector).show();

}


function hideElement(selector) {

  $w(selector).hide();

  $w(selector).collapse();

}


function formatDate(value) {

  var date =
    new Date(value);


  if (
    isNaN(date.getTime())
  ) {

    return '';

  }


  return date.toLocaleDateString(
    'en-IE',
    {
      day: 'numeric',
      month: 'long',
      year: 'numeric'
    }
  );

}