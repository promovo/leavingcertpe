$w.onReady(function () {
  $w('#schoolNameInput').show();
  $w('#schoolNameInput').expand();

  $w('#firstNameInput').show();
  $w('#firstNameInput').expand();

  $w('#lastNameInput').show();
  $w('#lastNameInput').expand();

  $w('#completeSetupSubmit').show();
  $w('#completeSetupSubmit').expand();

  $w('#setupErrorText').text = 'TEST — PAGE CODE IS RUNNING';
  $w('#setupErrorText').show();
  $w('#setupErrorText').expand();
});