import wixLocationFrontend from 'wix-location-frontend';
import { authentication, currentMember } from 'wix-members-frontend';
import { checkout } from 'wix-pricing-plans-frontend';

import {
  getPublicAccessOffer,
  getPendingPaidSetup,
  getEntitlementStatus,
  getLibraryNavigation,
  listResources,
  getResourcePayload
} from 'backend/resourceAccess.web';

let accessOffer = null;
let selectedChapter = null;
let selectedSubsection = null;
let selectedChapterHasSubsections = false;

$w.onReady(async function () {
  setupButtons();
  setupRepeaters();

  $w('#loginText').text =
    'Please log in or create an account to access the Resource Library.';

  const member = await getCurrentMemberWithRetry(5, 250);

  if (!member?._id) {
    console.log('Resource Library: visitor is logged out');
    await ensureLoggedOutState();
    return;
  }

  console.log('Resource Library: logged-in member detected', member._id);
  await enterLoggedInFlow();
});

async function getCurrentMemberWithRetry(attempts = 5, waitMilliseconds = 250) {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      const member = await currentMember.getMember();

      if (member?._id) {
        return member;
      }
    } catch (error) {
      console.log('Current member check attempt failed:', error);
    }

    if (attempt < attempts - 1) {
      await delay(waitMilliseconds);
    }
  }

  return undefined;
}

async function ensureLoggedOutState() {
  await hideAndCollapse('#loadingBox');
  await hideAndCollapse('#pendingSetupBox');
  await hideAndCollapse('#noAccessBox');
  await hideAndCollapse('#expiredBox');
  await hideAndCollapse('#libraryBox');

  await expandAndShow('#loginBox');
}

async function enterLoggedInFlow() {
  await hideAndCollapse('#loginBox');
  await showLoading();
  await delay(350);
  await loadLoggedInState();
}

async function loadLoggedInState() {
  try {
    const pending = await getPendingPaidSetup();

    if (pending?.ok && pending?.pending) {
      $w('#pendingSetupText').text =
        'Your payment has been confirmed. Please complete your access setup to continue.';

      await showLoggedInState('pending');
      return;
    }

    const status = await getEntitlementStatus();

    if (!status?.ok) {
      console.error('Entitlement status failed:', status);
      await showAccessError();
      return;
    }

    const entitlement = status.entitlement;

    if (!entitlement?.allowed) {
      if (isExpiredCode(entitlement?.code)) {
        $w('#expiredText').text =
          'Your Resource Library access has expired or is no longer active.';

        await showLoggedInState('expired');
        return;
      }

      await loadNoAccessState();
      return;
    }

    await loadLibrary(entitlement);
  } catch (error) {
    console.error('Resource Library logged-in check failed:', error);
    await showAccessError();
  }
}

async function hideAndCollapse(selector) {
  try {
    await $w(selector).hide();
  } catch (error) {
    console.log(`Could not hide ${selector}:`, error);
  }

  try {
    await $w(selector).collapse();
  } catch (error) {
    console.log(`Could not collapse ${selector}:`, error);
  }
}

async function expandAndShow(selector) {
  try {
    await $w(selector).expand();
  } catch (error) {
    console.log(`Could not expand ${selector}:`, error);
  }

  try {
    await $w(selector).show();
  } catch (error) {
    console.log(`Could not show ${selector}:`, error);
  }
}

async function showLoading() {
  await hideLoggedInStates();

  $w('#loadingText').text =
    'Checking your Resource Library access…';

  await expandAndShow('#loadingBox');
}

async function hideLoggedInStates() {
  await hideAndCollapse('#loadingBox');
  await hideAndCollapse('#pendingSetupBox');
  await hideAndCollapse('#noAccessBox');
  await hideAndCollapse('#expiredBox');
  await hideAndCollapse('#libraryBox');
}

async function showLoggedInState(state) {
  await hideLoggedInStates();

  if (state === 'pending') {
    await expandAndShow('#pendingSetupBox');
    return;
  }

  if (state === 'noAccess') {
    await expandAndShow('#noAccessBox');
    return;
  }

  if (state === 'expired') {
    await expandAndShow('#expiredBox');
    return;
  }

  if (state === 'library') {
    await expandAndShow('#libraryBox');
  }
}

function setupButtons() {
  $w('#loginButton').onClick(() => {
    authentication
      .promptLogin()
      .then(async () => {
        $w('#loginText').text = 'Signing you in…';

        const member =
          await getCurrentMemberWithRetry(8, 300);

        if (!member?._id) {
          console.error(
            'Login completed but member could not be retrieved.'
          );

          $w('#loginText').text =
            'Your login completed, but we could not verify your account. Please refresh the page.';

          await ensureLoggedOutState();
          return;
        }

        console.log(
          'Member confirmed after login:',
          member._id
        );

        await enterLoggedInFlow();
      })
      .catch((error) => {
        console.log(
          'Login cancelled or failed:',
          error
        );

        $w('#loginText').text =
          'Please log in or create an account to access the Resource Library.';
      });
  });

  $w('#completeSetupButton').onClick(() => {
    wixLocationFrontend.to('/complete-access-setup');
  });

  $w('#joinSchoolButton').onClick(() => {
    wixLocationFrontend.to('/join-school');
  });

  $w('#schoolPlanButton').onClick(() => {
    wixLocationFrontend.to('/pricing-plans');
  });

  $w('#individualPlanButton').onClick(() => {
    wixLocationFrontend.to('/pricing-plans');
  });

  $w('#backToChaptersButton').onClick(async () => {
    selectedChapter = null;
    selectedSubsection = null;
    selectedChapterHasSubsections = false;

    await hideAndCollapse('#subsectionBox');
    await hideAndCollapse('#resourcesBox');

    $w('#browseByChapterHeading').show();

    await expandAndShow('#chapterRepeater');
  });

  $w('#backToSubsectionsButton').onClick(async () => {
    selectedSubsection = null;

    await hideAndCollapse('#resourcesBox');

    if (selectedChapterHasSubsections) {
      await expandAndShow('#subsectionBox');
      return;
    }

    selectedChapter = null;

    $w('#browseByChapterHeading').show();

    await expandAndShow('#chapterRepeater');
  });
}

async function loadNoAccessState() {
  try {
    accessOffer = await getPublicAccessOffer();

    if (accessOffer?.ok) {
      if (accessOffer.schoolPrice) {
        $w('#schoolPlanButton').label =
          `School Access €${accessOffer.schoolPrice}`;
      }

      if (accessOffer.individualPrice) {
        $w('#individualPlanButton').label =
          `Individual Access €${accessOffer.individualPrice}`;
      }
    }

    $w('#noAccessHeading').text =
      'Choose how you would like to access the Resource Library';

    await showLoggedInState('noAccess');
  } catch (error) {
    console.error(
      'Unable to load access options:',
      error
    );

    await showAccessError();
  }
}

async function purchasePlan(type) {
  try {
    if (!accessOffer?.ok) {
      accessOffer = await getPublicAccessOffer();
    }

    const planId =
      type === 'SCHOOL'
        ? accessOffer?.schoolPlanId
        : accessOffer?.individualPlanId;

    if (!planId) {
      throw new Error('PLAN_NOT_AVAILABLE');
    }

    await checkout.startOnlinePurchase(planId);

    for (let attempt = 0; attempt < 8; attempt += 1) {
      await delay(1000);

      const pending = await getPendingPaidSetup();

      if (pending?.ok && pending?.pending) {
        wixLocationFrontend.to('/complete-access-setup');
        return;
      }
    }

    wixLocationFrontend.to('/complete-access-setup');
  } catch (error) {
    console.error('Purchase failed:', error);

    $w('#noAccessHeading').text =
      'We could not start this purchase. Please try again.';
  }
}

async function loadLibrary(entitlement) {
  try {
    const navigation = await getLibraryNavigation();

    if (!navigation?.ok) {
      console.error(
        'Library navigation failed:',
        navigation
      );

      await showAccessError();
      return;
    }

    setAccessSummary(entitlement);

    const chapters =
      Array.isArray(navigation.chapters)
        ? navigation.chapters
        : [];

    $w('#chapterRepeater').data =
      chapters.map((chapter) => ({
        ...chapter,
        _id: String(
          chapter.id ||
          chapter.chapterKey
        )
      }));

    selectedChapter = null;
    selectedSubsection = null;
    selectedChapterHasSubsections = false;

    await hideAndCollapse('#subsectionBox');
    await hideAndCollapse('#resourcesBox');

    $w('#browseByChapterHeading').show();

    await showLoggedInState('library');

    await expandAndShow('#chapterRepeater');
  } catch (error) {
    console.error(
      'Unable to load Resource Library:',
      error
    );

    await showAccessError();
  }
}

function setAccessSummary(entitlement) {
  $w('#libraryHeading').text =
    'Resource Library';

  if (entitlement.accessType === 'SCHOOL') {
    $w('#accessSummaryText').text =
      entitlement.schoolName
        ? `School access: ${entitlement.schoolName}`
        : 'School Resource Library access';
  } else {
    $w('#accessSummaryText').text =
      'Individual Resource Library access';
  }
}

function setupRepeaters() {
  $w('#chapterRepeater').onItemReady(
    ($item, chapter) => {
      $item('#chapterTitle').text =
        chapter.title || '';

      $item('#chapterDescription').text =
        chapter.description || '';

      $item('#openChapterButton').onClick(
        async () => {
          await openChapter(chapter);
        }
      );
    }
  );

  $w('#subsectionRepeater').onItemReady(
    ($item, subsection) => {
      $item('#subsectionTitle').text =
        subsection.title || '';

      $item('#openSubsectionButton').onClick(
        async () => {
          await openSubsection(subsection);
        }
      );
    }
  );

  $w('#resourceRepeater').onItemReady(
    ($item, resource) => {
      $item('#resourceTitle').text =
        resource.title || '';

      $item('#resourceDescription').text =
        resource.description || '';

      const meta = [
        resource.resourceType,
        resource.examYear
      ]
        .filter(Boolean)
        .join(' • ');

      $item('#resourceMeta').text = meta;

      $item('#openResourceButton').onClick(
        async () => {
          await openResource(resource);
        }
      );
    }
  );
}

async function openChapter(chapter) {
  selectedChapter = chapter;
  selectedSubsection = null;

  try {
    const navigation =
      await getLibraryNavigation();

    if (!navigation?.ok) {
      await showAccessError();
      return;
    }

    const allSubsections =
      Array.isArray(navigation.subsections)
        ? navigation.subsections
        : [];

    const subsections =
      allSubsections.filter((item) => {
        const exactChapterMatch =
          item.chapterKey ===
          chapter.chapterKey;

        const typeMatch =
          item.appliesToType ===
          chapter.chapterType;

        return (
          exactChapterMatch ||
          typeMatch
        );
      });

    selectedChapterHasSubsections =
      subsections.length > 0;

    if (subsections.length === 0) {
      await hideAndCollapse('#chapterRepeater');

      $w('#browseByChapterHeading').hide();

      await loadResources(null);
      return;
    }

    $w('#selectedChapterTitle').text =
      chapter.title || 'Resources';

    $w('#subsectionRepeater').data =
      subsections.map((item) => ({
        ...item,

        _id: String(
          item.id ||
          `${chapter.chapterKey}-${item.subsectionKey}`
        )
      }));

    await hideAndCollapse('#chapterRepeater');
    await hideAndCollapse('#resourcesBox');

    $w('#browseByChapterHeading').hide();

    await expandAndShow('#subsectionBox');
  } catch (error) {
    console.error(
      'Unable to open chapter:',
      error
    );

    await showAccessError();
  }
}

async function openSubsection(subsection) {
  selectedSubsection = subsection;

  await loadResources(
    subsection.subsectionKey
  );
}

async function loadResources(subsectionKey) {
  if (!selectedChapter) {
    return;
  }

  try {
    const result =
      await listResources({
        chapterKey:
          selectedChapter.chapterKey,

        subsectionKey:
          subsectionKey || ''
      });

    if (!result?.ok) {
      console.error(
        'Resource list failed:',
        result
      );

      await showAccessError();
      return;
    }

    const resources =
      Array.isArray(result.items)
        ? result.items
        : [];

    $w('#resourcesHeading').text =
      selectedSubsection?.title ||
      selectedChapter.title ||
      'Resources';

    $w('#resourceRepeater').data =
      resources.map((resource) => ({
        ...resource,
        _id: String(resource.id)
      }));

    await hideAndCollapse('#subsectionBox');

    if (resources.length === 0) {
      await hideAndCollapse('#resourceRepeater');

      await expandAndShow('#noResourcesText');
    } else {
      await hideAndCollapse('#noResourcesText');

      await expandAndShow('#resourceRepeater');
    }

    await expandAndShow('#resourcesBox');
  } catch (error) {
    console.error(
      'Unable to load resources:',
      error
    );

    await showAccessError();
  }
}

async function openResource(resource) {
  try {
    const result =
      await getResourcePayload(resource.id);

    if (!result?.ok || !result.resource) {
      console.error(
        'Protected resource payload failed:',
        result
      );

      await showAccessError();
      return;
    }

    const target =
      getResourceTarget(result.resource);

    if (!target) {
      console.error(
        'No resource URL or file available:',
        result.resource
      );

      return;
    }

    wixLocationFrontend.to(target);
  } catch (error) {
    console.error(
      'Unable to open resource:',
      error
    );
  }
}

function getResourceTarget(resource) {
  const possibilities = [
    resource.videoUrl,
    resource.resourceUrl,
    resource.documentFile,
    resource.videoFile
  ];

  for (const value of possibilities) {
    if (!value) {
      continue;
    }

    if (typeof value === 'string') {
      return value;
    }

    if (typeof value === 'object') {
      const url =
        value.url ||
        value.src ||
        value.fileUrl;

      if (url) {
        return url;
      }
    }
  }

  return null;
}

async function showAccessError() {
  $w('#noAccessHeading').text =
    'We could not check your Resource Library access. Please refresh the page and try again.';

  await showLoggedInState('noAccess');
}

function isExpiredCode(code) {
  return [
    'MEMBER_EXPIRED',
    'SCHOOL_EXPIRED',
    'ENTITLEMENT_INACTIVE',
    'SCHOOL_INACTIVE'
  ].includes(code);
}

function delay(milliseconds) {
  return new Promise((resolve) => {
    setTimeout(resolve, milliseconds);
  });
}