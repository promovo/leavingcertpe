import wixData from 'wix-data';

const CONFIG_NAME = 'Current LeavingCertPE Access Model';

const READ_OPTIONS = {
  suppressAuth: true,
  consistentRead: true
};

const WRITE_OPTIONS = {
  suppressAuth: true,
  suppressHooks: true
};


function dateKey(value) {

  if (!value) return null;

  if (typeof value === 'string') {
    return value.slice(0, 10);
  }

  const d =
    value instanceof Date
      ? value
      : new Date(value);

  if (Number.isNaN(d.getTime())) {
    return null;
  }

  return d
    .toISOString()
    .slice(0, 10);
}


function todayKey() {

  const parts =
    new Intl.DateTimeFormat(
      'en-IE',
      {
        timeZone:
          'Europe/Dublin',

        year:
          'numeric',

        month:
          '2-digit',

        day:
          '2-digit'
      }
    ).formatToParts(
      new Date()
    );


  const m =
    Object.fromEntries(
      parts.map(
        (p) => [
          p.type,
          p.value
        ]
      )
    );


  return `${m.year}-${m.month}-${m.day}`;
}


function subtractDays(
  dateValue,
  days
) {

  const key =
    dateKey(
      dateValue
    );


  if (!key) {
    return null;
  }


  const d =
    new Date(
      `${key}T12:00:00.000Z`
    );


  d.setUTCDate(
    d.getUTCDate() -
    Number(days || 0)
  );


  return d
    .toISOString()
    .slice(0, 10);
}


async function getConfig() {

  const result =
    await wixData
      .query(
        'AccessConfig'
      )
      .eq(
        'configName',
        CONFIG_NAME
      )
      .limit(1)
      .find(
        READ_OPTIONS
      );


  return result.items[0] || null;
}


async function reminderAlreadyQueued({
  eventType,
  schoolId,
  memberId,
  academicYearLabel
}) {

  let query =
    wixData
      .query(
        'AccessEvents'
      )
      .eq(
        'eventType',
        eventType
      );


  if (schoolId) {

    query =
      query.eq(
        'schoolId',
        schoolId
      );

  }


  if (memberId) {

    query =
      query.eq(
        'memberId',
        memberId
      );

  }


  if (academicYearLabel) {

    query =
      query.eq(
        'academicYearLabel',
        academicYearLabel
      );

  }


  const result =
    await query
      .limit(1)
      .find(
        READ_OPTIONS
      );


  return (
    result.items.length > 0
  );
}


async function logEvent(data) {

  await wixData.insert(
    'AccessEvents',
    {

      eventType:
        data.eventType,

      schoolId:
        data.schoolId ||
        null,

      memberId:
        data.memberId ||
        null,

      academicYearLabel:
        data.academicYearLabel ||
        null,

      effectiveDate:
        new Date(),

      oldStatus:
        data.oldStatus ||
        null,

      newStatus:
        data.newStatus ||
        null,

      orderId:
        data.orderId ||
        null,

      pricingPlanId:
        data.pricingPlanId ||
        null,

      source:
        'SCHEDULED_MAINTENANCE',

      notes:
        data.notes ||
        ''

    },
    WRITE_OPTIONS
  );
}


// =====================================================
// EXPIRE ALL ACTIVE USERS IN AN EXPIRED SCHOOL
// =====================================================

async function expireSchoolMembers(
  school
) {

  const result =
    await wixData
      .query(
        'SchoolMembers'
      )
      .eq(
        'schoolId',
        school._id
      )
      .eq(
        'accessType',
        'SCHOOL'
      )
      .eq(
        'status',
        'ACTIVE'
      )
      .limit(500)
      .find(
        READ_OPTIONS
      );


  for (
    const member
    of result.items
  ) {

    member.status =
      'EXPIRED';


    await wixData.update(
      'SchoolMembers',
      member,
      WRITE_OPTIONS
    );


    await logEvent({

      eventType:
        'MEMBER_ACCESS_EXPIRED',

      schoolId:
        school._id,

      memberId:
        member.memberId,

      academicYearLabel:
        member.academicYearLabel,

      oldStatus:
        'ACTIVE',

      newStatus:
        'EXPIRED',

      orderId:
        member.orderId,

      pricingPlanId:
        member.pricingPlanId

    });

  }

}


// =====================================================
// SCHOOL SUBSCRIPTIONS
// =====================================================

async function processSchools(
  config,
  today
) {

  const result =
    await wixData
      .query(
        'Schools'
      )
      .eq(
        'subscriptionStatus',
        'ACTIVE'
      )
      .limit(1000)
      .find(
        READ_OPTIONS
      );


  for (
    const school
    of result.items
  ) {

    const expiry =
      dateKey(
        school.expiryDate
      );


    if (!expiry) {
      continue;
    }


    // -----------------------------------------
    // EXPIRE SCHOOL
    // -----------------------------------------

    if (
      expiry < today
    ) {

      school.subscriptionStatus =
        'EXPIRED';


      await wixData.update(
        'Schools',
        school,
        WRITE_OPTIONS
      );


      await expireSchoolMembers(
        school
      );


      await logEvent({

        eventType:
          'SCHOOL_SUBSCRIPTION_EXPIRED',

        schoolId:
          school._id,

        academicYearLabel:
          school.academicYearLabel,

        oldStatus:
          'ACTIVE',

        newStatus:
          'EXPIRED',

        orderId:
          school.orderId,

        pricingPlanId:
          school.pricingPlanId

      });


      continue;

    }


    // -----------------------------------------
    // 30-DAY RENEWAL REMINDER
    // -----------------------------------------

    const due =
      subtractDays(
        school.expiryDate,
        config.renewalReminderDays ||
        30
      );


    if (
      due &&
      today >= due &&
      today <= expiry
    ) {

      const exists =
        await reminderAlreadyQueued({

          eventType:
            'SCHOOL_RENEWAL_REMINDER_DUE',

          schoolId:
            school._id,

          academicYearLabel:
            school.academicYearLabel

        });


      if (!exists) {

        await logEvent({

          eventType:
            'SCHOOL_RENEWAL_REMINDER_DUE',

          schoolId:
            school._id,

          academicYearLabel:
            school.academicYearLabel,

          orderId:
            school.orderId,

          pricingPlanId:
            school.pricingPlanId,

          notes:
            `Renewal reminder due for ${school.primaryContactEmail || 'school admin'} before ${expiry}.`

        });

      }

    }

  }

}


// =====================================================
// INDIVIDUAL SUBSCRIPTIONS
// =====================================================

async function processIndividuals(
  config,
  today
) {

  const result =
    await wixData
      .query(
        'SchoolMembers'
      )
      .eq(
        'accessType',
        'INDIVIDUAL'
      )
      .eq(
        'status',
        'ACTIVE'
      )
      .limit(1000)
      .find(
        READ_OPTIONS
      );


  for (
    const member
    of result.items
  ) {

    const expiry =
      dateKey(
        member.accessExpiryDate
      );


    if (!expiry) {
      continue;
    }


    // -----------------------------------------
    // EXPIRE INDIVIDUAL
    // -----------------------------------------

    if (
      expiry < today
    ) {

      member.status =
        'EXPIRED';


      await wixData.update(
        'SchoolMembers',
        member,
        WRITE_OPTIONS
      );


      await logEvent({

        eventType:
          'INDIVIDUAL_ACCESS_EXPIRED',

        memberId:
          member.memberId,

        academicYearLabel:
          member.academicYearLabel,

        oldStatus:
          'ACTIVE',

        newStatus:
          'EXPIRED',

        orderId:
          member.orderId,

        pricingPlanId:
          member.pricingPlanId

      });


      continue;

    }


    // -----------------------------------------
    // 30-DAY RENEWAL REMINDER
    // -----------------------------------------

    const due =
      subtractDays(
        member.accessExpiryDate,
        config.renewalReminderDays ||
        30
      );


    if (
      due &&
      today >= due &&
      today <= expiry
    ) {

      const exists =
        await reminderAlreadyQueued({

          eventType:
            'INDIVIDUAL_RENEWAL_REMINDER_DUE',

          memberId:
            member.memberId,

          academicYearLabel:
            member.academicYearLabel

        });


      if (!exists) {

        await logEvent({

          eventType:
            'INDIVIDUAL_RENEWAL_REMINDER_DUE',

          memberId:
            member.memberId,

          academicYearLabel:
            member.academicYearLabel,

          orderId:
            member.orderId,

          pricingPlanId:
            member.pricingPlanId,

          notes:
            `Renewal reminder due for ${member.email || 'individual subscriber'} before ${expiry}.`

        });

      }

    }

  }

}


// =====================================================
// DAILY JOB ENTRY POINT
// =====================================================

export async function runDailyAccessMaintenance() {

  const config =
    await getConfig();


  if (!config) {

    throw new Error(
      'ACCESS_CONFIG_NOT_FOUND'
    );

  }


  const today =
    todayKey();


  await processSchools(
    config,
    today
  );


  await processIndividuals(
    config,
    today
  );

}