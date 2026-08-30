import wixData from 'wix-data';

const SCHOOL_PLAN_ID = '6ee16af5-1b48-4192-a22b-4a29c1ed59e0';
const INDIVIDUAL_PLAN_ID = 'c7694ec9-54cc-4a6b-82ff-844281cc9e25';

const ACADEMIC_YEAR = '2026/27';
const FIXED_EXPIRY = new Date('2027-06-30T12:00:00.000Z');

const WRITE_OPTIONS = {
  suppressAuth: true,
  suppressHooks: true
};

const READ_OPTIONS = {
  suppressAuth: true,
  consistentRead: true
};


function normalizePricingPlanEvent(event) {

  // onOrderPurchased uses event.data.order.
  // onOrderMarkedAsPaid can supply the order as event.entity.
  const order =
    event?.data?.order ||
    event?.entity ||
    null;

  if (!order?._id) {
    return null;
  }


  const planId =
    event?.data?.planId ||
    order.planId ||
    null;


  const buyer =
    event?.data?.buyer ||
    order.buyer ||
    null;


  const memberId =
    buyer?.memberId ||
    null;


  const paymentStatus =
    order.lastPaymentStatus ||
    event?.data?.lastPaymentStatus ||
    null;


  return {
    order,
    planId,
    memberId,
    paymentStatus
  };
}


async function queuePaidOrder(event) {

  const normalized =
    normalizePricingPlanEvent(event);


  if (!normalized) {
    return;
  }


  const {
    order,
    planId,
    memberId,
    paymentStatus
  } = normalized;


  if (!memberId) {
    return;
  }


  // Ignore every other Pricing Plan on the site.
  if (
    ![
      SCHOOL_PLAN_ID,
      INDIVIDUAL_PLAN_ID
    ].includes(planId)
  ) {
    return;
  }


  // onOrderPurchased can also run when an
  // unpaid offline order is merely created.
  // Never grant/queue access before payment.
  if (paymentStatus !== 'PAID') {
    return;
  }


  // Prevent the same Wix order from being queued twice.
  const existing =
    await wixData
      .query('PendingAccess')
      .eq(
        'orderId',
        order._id
      )
      .limit(1)
      .find(
        READ_OPTIONS
      );


  if (existing.items.length) {
    return;
  }


  const accessType =
    planId === SCHOOL_PLAN_ID
      ? 'SCHOOL'
      : 'INDIVIDUAL';


  const purchaseDate =
    new Date(
      event?.metadata?.eventTime ||
      order._createdDate ||
      Date.now()
    );


  // -----------------------------------------
  // CREATE PENDING ACCESS RECORD
  // -----------------------------------------

  await wixData.insert(
    'PendingAccess',
    {

      memberId,

      planId,

      orderId:
        order._id,

      accessType,

      status:
        'PENDING_SETUP',

      academicYearLabel:
        ACADEMIC_YEAR,

      purchaseDate,

      expiryDate:
        FIXED_EXPIRY,

      notes:
        'Payment confirmed. Awaiting buyer setup before Resource Library entitlement is activated.'

    },
    WRITE_OPTIONS
  );


  // -----------------------------------------
  // AUDIT EVENT
  // -----------------------------------------

  await wixData.insert(
    'AccessEvents',
    {

      eventType:
        'PAYMENT_CONFIRMED_PENDING_SETUP',

      memberId,

      academicYearLabel:
        ACADEMIC_YEAR,

      effectiveDate:
        purchaseDate,

      newStatus:
        'PENDING_SETUP',

      orderId:
        order._id,

      pricingPlanId:
        planId,

      source:
        'WIX_PRICING_PLANS'

    },
    WRITE_OPTIONS
  );

}


// =====================================================
// WIX PRICING PLAN PURCHASE EVENT
// =====================================================

export async function wixPricingPlans_onOrderPurchased(event) {

  await queuePaidOrder(event);

}


// =====================================================
// OFFLINE ORDER MARKED PAID
// =====================================================

export async function wixPricingPlans_onOrderMarkedAsPaid(event) {

  await queuePaidOrder(event);

}