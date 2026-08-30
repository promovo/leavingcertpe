import wixLocationFrontend from 'wix-location-frontend';

import {
  authentication,
  currentMember
} from 'wix-members-frontend';

import {
  joinSchoolByCode
} from 'backend/resourceAccess.web';


$w.onReady(function () {

  $w('#joinErrorText').hide();

  $w('#joinSchoolSubmit').onClick(
    handleJoinSchool
  );

  $w('#joinGoToLibraryButton').onClick(
    () => {
      wixLocationFrontend.to(
        '/resource-library'
      );
    }
  );

});


async function handleJoinSchool() {

  $w('#joinErrorText').hide();

  const schoolCode =
    String(
      $w('#schoolCodeInput').value || ''
    )
      .trim()
      .toUpperCase();

  const firstName =
    String(
      $w('#joinFirstNameInput').value || ''
    ).trim();

  const lastName =
    String(
      $w('#joinLastNameInput').value || ''
    ).trim();

  const yearGroup =
    String(
      $w('#joinYearGroupInput').value || ''
    ).trim();


  // -----------------------------------------
  // BASIC VALIDATION
  // -----------------------------------------

  if (!schoolCode) {

    showError(
      'Please enter your school code.'
    );

    return;

  }


  if (
    !firstName ||
    !lastName
  ) {

    showError(
      'Please enter your first name and last name.'
    );

    return;

  }


  if (!yearGroup) {

    showError(
      'Please enter your year group.'
    );

    return;

  }


  // -----------------------------------------
  // MAKE SURE MEMBER IS LOGGED IN
  // -----------------------------------------

  try {

    let member =
      await currentMember.getMember();


    if (!member) {

      try {

        await authentication.promptLogin();

        member =
          await currentMember.getMember();

      }

      catch (error) {

        showError(
          'Please log in or create an account before joining your school.'
        );

        return;

      }

    }


    if (!member) {

      showError(
        'Please log in or create an account before joining your school.'
      );

      return;

    }

  }

  catch (error) {

    console.error(
      'Member check failed:',
      error
    );

    showError(
      'We could not check your account. Please try again.'
    );

    return;

  }


  // -----------------------------------------
  // JOIN SCHOOL
  // -----------------------------------------

  setSubmitLoading(
    true
  );


  try {

    const result =
      await joinSchoolByCode({

        schoolCode,

        firstName,

        lastName,

        yearGroup

      });


    if (!result?.ok) {

      showError(
        messageForCode(
          result?.code
        )
      );

      setSubmitLoading(
        false
      );

      return;

    }


    // -----------------------------------------
    // SUCCESS
    // -----------------------------------------

    $w('#joinedSchoolNameText').text =
      result.schoolName
        ? `You have successfully joined ${result.schoolName}.`
        : 'You have successfully joined your school.';


    $w('#joinedExpiryText').text =
      `Access expires: ${formatDate(
        result.expiryDate
      )}`;


    await $w(
      '#joinSuccessBox'
    ).expand();

    $w(
      '#joinSuccessBox'
    ).show();


    $w(
      '#joinSchoolSubmit'
    ).collapse();


    $w(
      '#schoolCodeInput'
    ).disable();

    $w(
      '#joinFirstNameInput'
    ).disable();

    $w(
      '#joinLastNameInput'
    ).disable();

    $w(
      '#joinYearGroupInput'
    ).disable();

  }

  catch (error) {

    console.error(
      'joinSchoolByCode failed:',
      error
    );


    showError(
      'Something went wrong while joining your school. Please try again.'
    );


    setSubmitLoading(
      false
    );

  }

}


// =============================================
// BUTTON STATE
// =============================================

function setSubmitLoading(
  loading
) {

  if (loading) {

    $w('#joinSchoolSubmit').label =
      'Joining...';

    $w('#joinSchoolSubmit').disable();

  }

  else {

    $w('#joinSchoolSubmit').label =
      'Join My School';

    $w('#joinSchoolSubmit').enable();

  }

}


// =============================================
// ERROR MESSAGES
// =============================================

function showError(
  message
) {

  $w('#joinErrorText').text =
    message;

  $w('#joinErrorText').show();

}


function messageForCode(
  code
) {

  switch (code) {

    case 'INVALID_SCHOOL_CODE':
    case 'SCHOOL_NOT_FOUND':

      return 'We could not find a school using that code. Please check the code and try again.';


    case 'SCHOOL_INACTIVE':

      return 'This school’s Resource Library access is not currently active. Please contact your school administrator.';


    case 'SCHOOL_EXPIRED':

      return 'This school’s Resource Library access has expired. Please contact your school administrator.';


    case 'SCHOOL_FULL':
    case 'NO_SEATS_AVAILABLE':

      return 'This school has reached its current user limit. Please contact your school administrator.';


    case 'ALREADY_HAS_ACCESS':
    case 'MEMBER_ALREADY_LINKED':

      return 'This account already has Resource Library access.';


    case 'REQUIRED_DETAILS_MISSING':

      return 'Please complete all of the required details.';


    default:

      return 'We could not join you to that school. Please check the school code and try again.';

  }

}


// =============================================
// DATE
// =============================================

function formatDate(
  value
) {

  if (!value) {

    return '30 June 2027';

  }


  const date =
    value instanceof Date
      ? value
      : new Date(
          value
        );


  if (
    Number.isNaN(
      date.getTime()
    )
  ) {

    return '30 June 2027';

  }


  return new Intl.DateTimeFormat(
    'en-IE',
    {
      day: 'numeric',
      month: 'long',
      year: 'numeric'
    }
  ).format(
    date
  );

}