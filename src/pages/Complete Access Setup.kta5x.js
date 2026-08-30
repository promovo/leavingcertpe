import wixLocationFrontend from 'wix-location-frontend';

import {
  getPendingPaidSetup,
  completePaidAccessSetup
} from 'backend/resourceAccess.web';

let pendingAccessType = '';

$w.onReady(async function () {

  $w('#completeSetupSubmit').onClick(async () => {
    await submitSetup();
  });

  $w('#goToLibraryButton').onClick(() => {
    wixLocationFrontend.to('/resource-library');
  });

  // Initial page state
  showAndExpand('#setupHeading');
  showAndExpand('#setupIntro');
  showAndExpand('#schoolNameInput');
  showAndExpand('#firstNameInput');
  showAndExpand('#lastNameInput');
  showAndExpand('#completeSetupSubmit');

  hideAndCollapse('#setupSuccessBox');
  hideElement('#setupErrorText');

  try {

    const pending = await getPendingPaidSetup();

    console.log('Pending setup:', pending);

    if (!pending?.ok) {
      showError(
        'We could not check your access setup. Please return to the Resource Library and try again.'
      );
      return;
    }

    if (!pending.pending) {
      showError(
        'There is no paid access waiting to be set up for this account.'
      );
      return;
    }

    pendingAccessType = pending.accessType;

    if (pendingAccessType === 'SCHOOL') {

      $w('#yearGroupInput').value = '';

      hideAndCollapse('#yearGroupInput');

    } else {

      showAndExpand('#yearGroupInput');

    }

  } catch (error) {

    console.error('Setup page load failed:', error);

    showError(
      'We could not load your access setup. Please return to the Resource Library and try again.'
    );

  }
});


async function submitSetup() {

  hideElement('#setupErrorText');

  const schoolName =
    String($w('#schoolNameInput').value || '').trim();

  const firstName =
    String($w('#firstNameInput').value || '').trim();

  const lastName =
    String($w('#lastNameInput').value || '').trim();

  const yearGroup =
    String($w('#yearGroupInput').value || '').trim();


  if (!schoolName || !firstName || !lastName) {

    showError(
      'Please enter your school name, first name and last name.'
    );

    return;
  }


  if (
    pendingAccessType === 'INDIVIDUAL' &&
    !yearGroup
  ) {

    showError(
      'Please enter your year group.'
    );

    return;
  }


  try {

    $w('#completeSetupSubmit').disable();
    $w('#completeSetupSubmit').label =
      'Completing Setup…';


    const result =
      await completePaidAccessSetup({
        schoolName,
        firstName,
        lastName,
        yearGroup
      });


    console.log('Setup result:', result);


    if (!result?.ok) {

      if (
        result?.code ===
        'NO_PENDING_PAID_ACCESS'
      ) {

        showError(
          'There is no paid access waiting to be set up for this account.'
        );

      } else if (
        result?.code ===
        'REQUIRED_SETUP_DETAILS_MISSING'
      ) {

        showError(
          'Please complete all required details.'
        );

      } else {

        showError(
          'We could not complete your access setup. Please try again.'
        );

      }

      return;
    }


    showSuccess(result);

  } catch (error) {

    console.error(
      'Complete setup failed:',
      error
    );

    showError(
      'We could not complete your access setup. Please try again.'
    );

  } finally {

    try {

      $w('#completeSetupSubmit').enable();

      $w('#completeSetupSubmit').label =
        'Complete Setup';

    } catch (error) {

      console.log(
        'Could not reset setup button:',
        error
      );

    }

  }
}


function showSuccess(result) {

  // Remove the setup instructions completely
  hideAndCollapse('#setupHeading');
  hideAndCollapse('#setupIntro');

  // Remove form
  hideAndCollapse('#schoolNameInput');
  hideAndCollapse('#firstNameInput');
  hideAndCollapse('#lastNameInput');
  hideAndCollapse('#yearGroupInput');
  hideAndCollapse('#completeSetupSubmit');

  hideElement('#setupErrorText');


  if (result.accessType === 'SCHOOL') {

    $w('#generatedSchoolCodeText').text =
      `Your school access is active.\n\nSchool code: ${result.schoolCode}`;

  } else {

    $w('#generatedSchoolCodeText').text =
      'Your individual Resource Library access is now active.';

  }


  $w('#setupExpiryText').text =
    result.expiryDate
      ? `Access expires: ${formatDate(result.expiryDate)}`
      : '';


  showAndExpand('#setupSuccessBox');
}


function showError(message) {

  $w('#setupErrorText').text = message;

  $w('#setupErrorText').show();

}


function hideElement(selector) {

  try {
    $w(selector).hide();
  } catch (error) {
    console.log(
      `Could not hide ${selector}:`,
      error
    );
  }

}


function hideAndCollapse(selector) {

  try {
    $w(selector).hide();
  } catch (error) {
    console.log(
      `Could not hide ${selector}:`,
      error
    );
  }

  try {
    $w(selector).collapse();
  } catch (error) {
    console.log(
      `Could not collapse ${selector}:`,
      error
    );
  }

}


function showAndExpand(selector) {

  try {
    $w(selector).expand();
  } catch (error) {
    console.log(
      `Could not expand ${selector}:`,
      error
    );
  }

  try {
    $w(selector).show();
  } catch (error) {
    console.log(
      `Could not show ${selector}:`,
      error
    );
  }

}


function formatDate(value) {

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
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