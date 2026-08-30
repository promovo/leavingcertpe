import wixData from 'wix-data';
import { Permissions, webMethod } from '@wix/web-methods';
import { currentMember } from 'wix-members-backend';


const CONFIG_NAME = 'Current LeavingCertPE Access Model';
const SITE_TIME_ZONE = 'Europe/Dublin';


const READ_OPTIONS = {
  suppressAuth: true,
  consistentRead: true
};


const WRITE_OPTIONS = {
  suppressAuth: true,
  suppressHooks: true
};


const ACTIVE = 'ACTIVE';
const ACCESS_SCHOOL = 'SCHOOL';
const ACCESS_INDIVIDUAL = 'INDIVIDUAL';
const ROLE_ADMIN = 'ADMIN';
const ROLE_TEACHER = 'TEACHER';
const ROLE_STUDENT = 'STUDENT';


function cleanText(value, maxLength = 120) {
  return String(value ?? '').trim().slice(0, maxLength);
}


function normalizeSchoolCode(value) {
  return cleanText(value, 40).toUpperCase().replace(/\s+/g, '');
}


function dublinTodayKey() {
  const parts = new Intl.DateTimeFormat('en-IE', {
    timeZone: SITE_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).formatToParts(new Date());


  const map = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${map.year}-${map.month}-${map.day}`;
}


function storedDateKey(value) {
  if (!value) return null;
  if (typeof value === 'string') return value.slice(0, 10);
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString().slice(0, 10);
}


function checkDateWindow(startDate, expiryDate) {
  const today = dublinTodayKey();
  const start = storedDateKey(startDate);
  const expiry = storedDateKey(expiryDate);


  if (start && start > today) return { ok: false, code: 'NOT_STARTED' };
  if (!expiry) return { ok: false, code: 'EXPIRY_NOT_SET' };
  if (expiry < today) return { ok: false, code: 'EXPIRED' };
  return { ok: true, code: 'ACTIVE' };
}


async function getCurrentMemberOrThrow() {
  const member = await currentMember.getMember({ fieldsets: ['FULL'] });
  if (!member?._id) {
    throw new Error('MEMBER_REQUIRED');
  }
  return member;
}


async function getCurrentConfig() {
  const result = await wixData.query('AccessConfig')
    .eq('configName', CONFIG_NAME)
    .limit(1)
    .find(READ_OPTIONS);


  return result.items[0] || null;
}


async function getMemberAccessRecord(memberId) {
  const result = await wixData.query('SchoolMembers')
    .eq('memberId', memberId)
    .limit(1)
    .find(READ_OPTIONS);


  return result.items[0] || null;
}


async function getSchoolById(schoolId) {
  if (!schoolId) return null;
  return wixData.get('Schools', schoolId, READ_OPTIONS);
}


async function getSchoolByCode(schoolCode) {
  const result = await wixData.query('Schools')
    .eq('schoolCode', schoolCode)
    .limit(1)
    .find(READ_OPTIONS);


  return result.items[0] || null;
}


async function countActiveSchoolMembers(schoolId) {
  const result = await wixData.query('SchoolMembers')
    .eq('schoolId', schoolId)
    .eq('accessType', ACCESS_SCHOOL)
    .eq('status', ACTIVE)
    .limit(1)
    .find(READ_OPTIONS);


  return result.totalCount || 0;
}


async function syncSchoolSeatCount(school) {
  const count = await countActiveSchoolMembers(school._id);
  const updatedSchool = {
    ...school,
    seatsUsed: count
  };
  await wixData.update('Schools', updatedSchool, WRITE_OPTIONS);
  return count;
}


async function logAccessEvent(event) {
  try {
    await wixData.insert('AccessEvents', {
      eventType: cleanText(event.eventType, 80),
      schoolId: event.schoolId || null,
      memberId: event.memberId || null,
      academicYearLabel: event.academicYearLabel || null,
      effectiveDate: new Date(),
      oldStatus: event.oldStatus || null,
      newStatus: event.newStatus || null,
      seatsBefore: Number.isFinite(event.seatsBefore) ? event.seatsBefore : null,
      seatsAfter: Number.isFinite(event.seatsAfter) ? event.seatsAfter : null,
      orderId: event.orderId || null,
      pricingPlanId: event.pricingPlanId || null,
      source: cleanText(event.source || 'SYSTEM', 80),
      notes: cleanText(event.notes || '', 1000)
    }, WRITE_OPTIONS);
  } catch (error) {
    console.error('AccessEvents insert failed:', error);
  }
}


async function resolveEntitlement(memberId) {
  const access = await getMemberAccessRecord(memberId);


  if (!access) {
    return { allowed: false, code: 'NO_ENTITLEMENT' };
  }


  if (access.status !== ACTIVE) {
    return { allowed: false, code: 'ENTITLEMENT_INACTIVE', accessRecord: access };
  }


  const memberWindow = checkDateWindow(access.accessStartDate, access.accessExpiryDate);
  if (!memberWindow.ok) {
    return { allowed: false, code: `MEMBER_${memberWindow.code}`, accessRecord: access };
  }


  if (access.accessType === ACCESS_INDIVIDUAL) {
    return {
      allowed: true,
      code: 'ACTIVE_INDIVIDUAL',
      accessRecord: access,
      schoolRecord: null
    };
  }


  if (access.accessType !== ACCESS_SCHOOL || !access.schoolId) {
    return { allowed: false, code: 'INVALID_ACCESS_TYPE', accessRecord: access };
  }


  const school = await getSchoolById(access.schoolId);
  if (!school || school.subscriptionStatus !== ACTIVE) {
    return { allowed: false, code: 'SCHOOL_INACTIVE', accessRecord: access, schoolRecord: school };
  }


  const schoolWindow = checkDateWindow(school.startDate, school.expiryDate);
  if (!schoolWindow.ok) {
    return {
      allowed: false,
      code: `SCHOOL_${schoolWindow.code}`,
      accessRecord: access,
      schoolRecord: school
    };
  }


  return {
    allowed: true,
    code: 'ACTIVE_SCHOOL',
    accessRecord: access,
    schoolRecord: school
  };
}


function publicEntitlement(result) {
  if (!result?.allowed) {
    return {
      allowed: false,
      code: result?.code || 'ACCESS_DENIED'
    };
  }


  const access = result.accessRecord;
  const school = result.schoolRecord;


  return {
    allowed: true,
    code: result.code,
    accessType: access.accessType,
    role: access.role || ROLE_STUDENT,
    schoolId: access.schoolId || null,
    schoolName: school?.schoolName || access.schoolName || null,
    academicYearLabel: access.academicYearLabel || school?.academicYearLabel || null,
    accessExpiryDate: access.accessExpiryDate || school?.expiryDate || null
  };
}


async function requireSchoolAdmin(currentMemberId) {
  const entitlement = await resolveEntitlement(currentMemberId);
  if (!entitlement.allowed) {
    return { ok: false, code: entitlement.code };
  }


  const access = entitlement.accessRecord;
  if (access.accessType !== ACCESS_SCHOOL || access.role !== ROLE_ADMIN || !access.schoolId) {
    return { ok: false, code: 'SCHOOL_ADMIN_REQUIRED' };
  }


  return {
    ok: true,
    entitlement,
    schoolId: access.schoolId,
    school: entitlement.schoolRecord
  };
}


export const getPublicAccessOffer = webMethod(
  Permissions.Anyone,
  async () => {
    try {
      const config = await getCurrentConfig();
      if (!config) return { ok: false, code: 'CONFIG_NOT_FOUND' };


      return {
        ok: true,
        academicYearLabel: config.academicYearLabel || null,
        academicYearEndDate: config.academicYearEndDate || null,
        schoolPlanId: config.schoolPlanId || null,
        individualPlanId: config.individualPlanId || null,
        schoolPrice: config.schoolPrice ?? null,
        schoolSeatLimit: config.schoolSeatLimit ?? null,
        individualPrice: config.individualPrice ?? null,
        extraSeatBlockSize: config.extraSeatBlockSize ?? null,
        extraSeatPrice: config.extraSeatPrice ?? null,
        renewalReminderDays: config.renewalReminderDays ?? null
      };
    } catch (error) {
      console.error('getPublicAccessOffer failed:', error);
      return { ok: false, code: 'UNEXPECTED_ERROR' };
    }
  }
);


export const getEntitlementStatus = webMethod(
  Permissions.SiteMember,
  async () => {
    try {
      const currentMember = await getCurrentMemberOrThrow();
      const entitlement = await resolveEntitlement(currentMember._id);
      return { ok: true, entitlement: publicEntitlement(entitlement) };
    } catch (error) {
      console.error('getEntitlementStatus failed:', error);
      return { ok: false, code: 'UNEXPECTED_ERROR' };
    }
  }
);


export const joinSchoolByCode = webMethod(
  Permissions.SiteMember,
  async (input = {}) => {
    try {
      const currentMember = await getCurrentMemberOrThrow();


      const existingEntitlement = await resolveEntitlement(currentMember._id);
      if (existingEntitlement.allowed) {
        const publicAccess = publicEntitlement(existingEntitlement);
        return {
          ok: true,
          alreadyEntitled: true,
          schoolName: publicAccess.schoolName || null,
          expiryDate: publicAccess.accessExpiryDate || null,
          entitlement: publicAccess
        };
      }


      const schoolCode = normalizeSchoolCode(input.schoolCode);
      const firstName = cleanText(input.firstName, 80);
      const lastName = cleanText(input.lastName, 80);
      const yearGroup = cleanText(input.yearGroup, 40);


      if (!schoolCode || schoolCode.length < 4 || !/^[A-Z0-9-]+$/.test(schoolCode)) {
        return { ok: false, code: 'INVALID_OR_INACTIVE_SCHOOL_CODE' };
      }

      if (!firstName || !lastName || !yearGroup) {
        return { ok: false, code: 'REQUIRED_DETAILS_MISSING' };
      }


      const school = await getSchoolByCode(schoolCode);

      if (!school || school.subscriptionStatus !== ACTIVE) {
        return { ok: false, code: 'INVALID_OR_INACTIVE_SCHOOL_CODE' };
      }


      const schoolWindow = checkDateWindow(school.startDate, school.expiryDate);

      if (!schoolWindow.ok) {
        return { ok: false, code: 'INVALID_OR_INACTIVE_SCHOOL_CODE' };
      }


      const standardSeats = Number(school.seatAllowance || 0);
      const extraSeats = Number(school.extraSeatAllowance || 0);
      const seatLimit = standardSeats + extraSeats;

      if (seatLimit < 1) {
        return { ok: false, code: 'SCHOOL_SEAT_CONFIGURATION_ERROR' };
      }


      const seatsBefore = await countActiveSchoolMembers(school._id);

      if (seatsBefore >= seatLimit) {
        await logAccessEvent({
          eventType: 'JOIN_REJECTED_SEAT_LIMIT',
          schoolId: school._id,
          memberId: currentMember._id,
          academicYearLabel: school.academicYearLabel,
          seatsBefore,
          seatsAfter: seatsBefore,
          source: 'SCHOOL_CODE'
        });

        return { ok: false, code: 'SCHOOL_SEAT_LIMIT_REACHED' };
      }


      const existingRecord = await getMemberAccessRecord(currentMember._id);
      const originalRecord = existingRecord ? { ...existingRecord } : null;


      const entitlementRecord = {
        ...(existingRecord || {}),
        memberId: currentMember._id,
        schoolId: school._id,
        schoolName: school.schoolName,
        firstName,
        lastName,
        email: currentMember.loginEmail || existingRecord?.email || '',
        yearGroup,
        role: ROLE_STUDENT,
        status: ACTIVE,
        accessType: ACCESS_SCHOOL,
        accessStartDate: school.startDate,
        accessExpiryDate: school.expiryDate,
        academicYearLabel: school.academicYearLabel,
        pricingPlanId: school.pricingPlanId || null,
        orderId: school.orderId || null
      };


      const saved = existingRecord
        ? await wixData.update('SchoolMembers', entitlementRecord, WRITE_OPTIONS)
        : await wixData.insert('SchoolMembers', entitlementRecord, WRITE_OPTIONS);


      const seatsAfter = await countActiveSchoolMembers(school._id);


      if (seatsAfter > seatLimit) {
        if (originalRecord) {
          await wixData.update('SchoolMembers', originalRecord, WRITE_OPTIONS);
        } else {
          await wixData.remove('SchoolMembers', saved._id, WRITE_OPTIONS);
        }

        await syncSchoolSeatCount(school);

        await logAccessEvent({
          eventType: 'JOIN_REJECTED_SEAT_LIMIT',
          schoolId: school._id,
          memberId: currentMember._id,
          academicYearLabel: school.academicYearLabel,
          seatsBefore,
          seatsAfter,
          source: 'SCHOOL_CODE',
          notes: 'Second consistent seat check exceeded allowance; entitlement write rolled back.'
        });

        return { ok: false, code: 'SCHOOL_SEAT_LIMIT_REACHED' };
      }


      await syncSchoolSeatCount(school);

      await logAccessEvent({
        eventType: existingRecord ? 'MEMBER_REACTIVATED' : 'MEMBER_ADDED',
        schoolId: school._id,
        memberId: currentMember._id,
        academicYearLabel: school.academicYearLabel,
        oldStatus: originalRecord?.status || null,
        newStatus: ACTIVE,
        seatsBefore,
        seatsAfter,
        orderId: school.orderId || null,
        pricingPlanId: school.pricingPlanId || null,
        source: 'SCHOOL_CODE'
      });


      const entitlement = await resolveEntitlement(currentMember._id);

      return {
        ok: entitlement.allowed,
        entitlement: publicEntitlement(entitlement)
      };
    } catch (error) {
      console.error('joinSchoolByCode failed:', error);
      return { ok: false, code: 'UNEXPECTED_ERROR' };
    }
  }
);


export const getLibraryNavigation = webMethod(
  Permissions.SiteMember,
  async () => {
    try {
      const currentMember = await getCurrentMemberOrThrow();
      const entitlement = await resolveEntitlement(currentMember._id);

      if (!entitlement.allowed) {
        return { ok: false, entitlement: publicEntitlement(entitlement) };
      }


      const [chapterResult, subsectionResult] = await Promise.all([
        wixData.query('Chapters')
          .eq('published', true)
          .ascending('sortOrder')
          .limit(100)
          .find(READ_OPTIONS),

        wixData.query('Subsections')
          .eq('published', true)
          .ascending('sortOrder')
          .limit(100)
          .find(READ_OPTIONS)
      ]);


      return {
        ok: true,
        entitlement: publicEntitlement(entitlement),

        chapters: chapterResult.items.map((item) => ({
          id: item._id,
          chapterKey: item.chapterKey,
          title: item.title,
          chapterType: item.chapterType,
          description: item.description || '',
          sortOrder: item.sortOrder || 0
        })),

        subsections: subsectionResult.items.map((item) => ({
          id: item._id,
          subsectionKey: item.subsectionKey,
          chapterKey: item.chapterKey || null,
          title: item.title,
          appliesToType: item.appliesToType,
          sortOrder: item.sortOrder || 0
        }))
      };
    } catch (error) {
      console.error('getLibraryNavigation failed:', error);
      return { ok: false, code: 'UNEXPECTED_ERROR' };
    }
  }
);


export const listResources = webMethod(
  Permissions.SiteMember,
  async (input = {}) => {
    try {
      const currentMember = await getCurrentMemberOrThrow();
      const entitlement = await resolveEntitlement(currentMember._id);

      if (!entitlement.allowed) {
        return { ok: false, entitlement: publicEntitlement(entitlement) };
      }


      const chapterKey = cleanText(input.chapterKey, 100);
      const subsectionKey = cleanText(input.subsectionKey, 100);
      const resourceType = cleanText(input.resourceType, 80);
      const limit = Math.min(Math.max(Number(input.limit) || 50, 1), 100);
      const offset = Math.max(Number(input.offset) || 0, 0);


      if (!chapterKey) {
        return { ok: false, code: 'CHAPTER_REQUIRED' };
      }


      let query = wixData.query('Resources')
        .eq('published', true)
        .eq('chapterKey', chapterKey);


      if (subsectionKey) {
        query = query.eq('subsectionKey', subsectionKey);
      }

      if (resourceType) {
        query = query.eq('resourceType', resourceType);
      }


      const result = await query
        .ascending('sortOrder')
        .skip(offset)
        .limit(limit)
        .find(READ_OPTIONS);


      return {
        ok: true,
        totalCount: result.totalCount || 0,

        items: result.items.map((item) => ({
          id: item._id,
          title: item.title,
          chapterKey: item.chapterKey,
          subsectionKey: item.subsectionKey,
          resourceType: item.resourceType,
          description: item.description || '',
          examYear: item.examYear || null,
          sortOrder: item.sortOrder || 0,
          featured: Boolean(item.featured),
          thumbnail: item.thumbnail || null,
          viewOnlyPreferred: Boolean(item.viewOnlyPreferred)
        }))
      };
    } catch (error) {
      console.error('listResources failed:', error);
      return { ok: false, code: 'UNEXPECTED_ERROR' };
    }
  }
);


export const getResourcePayload = webMethod(
  Permissions.SiteMember,
  async (resourceId) => {
    try {
      const currentMember = await getCurrentMemberOrThrow();
      const entitlement = await resolveEntitlement(currentMember._id);

      if (!entitlement.allowed) {
        return { ok: false, entitlement: publicEntitlement(entitlement) };
      }


      const id = cleanText(resourceId, 80);

      if (!id) {
        return { ok: false, code: 'RESOURCE_REQUIRED' };
      }


      const item = await wixData.get('Resources', id, READ_OPTIONS);

      if (!item || item.published !== true) {
        return { ok: false, code: 'RESOURCE_NOT_FOUND' };
      }


      return {
        ok: true,

        resource: {
          id: item._id,
          title: item.title,
          resourceType: item.resourceType,
          description: item.description || '',
          examYear: item.examYear || null,
          viewOnlyPreferred: Boolean(item.viewOnlyPreferred),
          documentFile: item.documentFile || null,
          videoFile: item.videoFile || null,
          resourceUrl: item.resourceUrl || null,
          videoUrl: item.videoUrl || null
        }
      };
    } catch (error) {
      console.error('getResourcePayload failed:', error);
      return { ok: false, code: 'UNEXPECTED_ERROR' };
    }
  }
);


export const listMySchoolMembers = webMethod(
  Permissions.SiteMember,
  async () => {
    try {
      const currentMember = await getCurrentMemberOrThrow();
      const admin = await requireSchoolAdmin(currentMember._id);

      if (!admin.ok) {
        return admin;
      }


      const result = await wixData.query('SchoolMembers')
        .eq('schoolId', admin.schoolId)
        .eq('accessType', ACCESS_SCHOOL)
        .eq('status', ACTIVE)
        .ascending('lastName', 'firstName')
        .limit(500)
        .find(READ_OPTIONS);


      const primaryAdminMemberId = admin.school?.primaryAdminMemberId || null;

      const seatAllowance =
        Number(admin.school?.seatAllowance || 0) +
        Number(admin.school?.extraSeatAllowance || 0);


      return {
        ok: true,
        schoolName: admin.school?.schoolName || null,
        schoolCode: admin.school?.schoolCode || null,
        academicYearLabel: admin.school?.academicYearLabel || null,
        expiryDate: admin.school?.expiryDate || null,
        primaryAdminMemberId,
        seatAllowance,
        seatsUsed: result.totalCount || 0,

        members: result.items.map((item) => ({
          memberId: item.memberId,
          firstName: item.firstName,
          lastName: item.lastName,
          email: item.email,
          yearGroup: item.yearGroup || '',
          role: item.role || ROLE_STUDENT,
          isPrimaryAdmin: item.memberId === primaryAdminMemberId
        }))
      };
    } catch (error) {
      console.error('listMySchoolMembers failed:', error);
      return { ok: false, code: 'UNEXPECTED_ERROR' };
    }
  }
);


export const removeSchoolMember = webMethod(
  Permissions.SiteMember,
  async (targetMemberId) => {
    try {
      const currentMember = await getCurrentMemberOrThrow();
      const admin = await requireSchoolAdmin(currentMember._id);

      if (!admin.ok) {
        return admin;
      }


      const targetId = cleanText(targetMemberId, 80);

      if (!targetId || targetId === currentMember._id) {
        return { ok: false, code: 'INVALID_TARGET_MEMBER' };
      }


      const target = await getMemberAccessRecord(targetId);

      if (!target || target.schoolId !== admin.schoolId || target.accessType !== ACCESS_SCHOOL) {
        return { ok: false, code: 'MEMBER_NOT_IN_SCHOOL' };
      }


      if (target.memberId === admin.school?.primaryAdminMemberId) {
        return { ok: false, code: 'PRIMARY_ADMIN_CANNOT_BE_REMOVED' };
      }


      const seatsBefore = await countActiveSchoolMembers(admin.schoolId);
      const oldStatus = target.status;

      target.status = 'REMOVED';

      await wixData.update('SchoolMembers', target, WRITE_OPTIONS);

      const seatsAfter = await syncSchoolSeatCount(admin.school);


      await logAccessEvent({
        eventType: 'MEMBER_REMOVED',
        schoolId: admin.schoolId,
        memberId: target.memberId,
        academicYearLabel: target.academicYearLabel,
        oldStatus,
        newStatus: 'REMOVED',
        seatsBefore,
        seatsAfter,
        source: 'SCHOOL_ADMIN'
      });


      return {
        ok: true,
        seatsUsed: seatsAfter
      };
    } catch (error) {
      console.error('removeSchoolMember failed:', error);
      return { ok: false, code: 'UNEXPECTED_ERROR' };
    }
  }
);


export const setSchoolMemberRole = webMethod(
  Permissions.SiteMember,
  async (targetMemberId, newRole) => {
    try {
      const currentMember = await getCurrentMemberOrThrow();
      const admin = await requireSchoolAdmin(currentMember._id);

      if (!admin.ok) {
        return admin;
      }


      const targetId = cleanText(targetMemberId, 80);
      const role = cleanText(newRole, 20).toUpperCase();
      const allowedRoles = [ROLE_STUDENT, ROLE_TEACHER, ROLE_ADMIN];


      if (!targetId || !allowedRoles.includes(role)) {
        return { ok: false, code: 'INVALID_ROLE_CHANGE' };
      }


      const target = await getMemberAccessRecord(targetId);

      if (!target || target.schoolId !== admin.schoolId || target.accessType !== ACCESS_SCHOOL) {
        return { ok: false, code: 'MEMBER_NOT_IN_SCHOOL' };
      }


      if (target.memberId === admin.school?.primaryAdminMemberId && role !== ROLE_ADMIN) {
        return { ok: false, code: 'PRIMARY_ADMIN_MUST_REMAIN_ADMIN' };
      }


      const oldRole = target.role || ROLE_STUDENT;

      target.role = role;

      await wixData.update('SchoolMembers', target, WRITE_OPTIONS);


      await logAccessEvent({
        eventType: 'MEMBER_ROLE_CHANGED',
        schoolId: admin.schoolId,
        memberId: target.memberId,
        academicYearLabel: target.academicYearLabel,
        source: 'SCHOOL_ADMIN',
        notes: `${oldRole} -> ${role}`
      });


      return {
        ok: true,
        role
      };
    } catch (error) {
      console.error('setSchoolMemberRole failed:', error);
      return { ok: false, code: 'UNEXPECTED_ERROR' };
    }
  }
);


async function getPendingAccessForMember(memberId) {
  const result = await wixData.query('PendingAccess')
    .eq('memberId', memberId)
    .eq('status', 'PENDING_SETUP')
    .descending('purchaseDate')
    .limit(1)
    .find(READ_OPTIONS);


  return result.items[0] || null;
}


function makeSchoolCodeCandidate() {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let randomPart = '';


  for (let i = 0; i < 12; i += 1) {
    randomPart += alphabet[Math.floor(Math.random() * alphabet.length)];
  }


  return `LCPE-${randomPart}`;
}


async function generateUniqueSchoolCode() {
  for (let attempt = 0; attempt < 12; attempt += 1) {
    const candidate = makeSchoolCodeCandidate();

    const existing = await wixData.query('Schools')
      .eq('schoolCode', candidate)
      .limit(1)
      .find(READ_OPTIONS);


    if (!existing.items.length) {
      return candidate;
    }
  }


  throw new Error('SCHOOL_CODE_GENERATION_FAILED');
}


async function saveMemberEntitlement(memberId, record) {
  const existing = await getMemberAccessRecord(memberId);

  const fullRecord = {
    ...(existing || {}),
    ...record,
    memberId
  };


  return existing
    ? wixData.update('SchoolMembers', fullRecord, WRITE_OPTIONS)
    : wixData.insert('SchoolMembers', fullRecord, WRITE_OPTIONS);
}


export const getPendingPaidSetup = webMethod(
  Permissions.SiteMember,
  async () => {
    try {
      const currentMember = await getCurrentMemberOrThrow();
      const pending = await getPendingAccessForMember(currentMember._id);


      if (!pending) {
        return {
          ok: true,
          pending: false
        };
      }


      return {
        ok: true,
        pending: true,
        accessType: pending.accessType,
        academicYearLabel: pending.academicYearLabel,
        expiryDate: pending.expiryDate
      };
    } catch (error) {
      console.error('getPendingPaidSetup failed:', error);
      return { ok: false, code: 'UNEXPECTED_ERROR' };
    }
  }
);


export const completePaidAccessSetup = webMethod(
  Permissions.SiteMember,
  async (input = {}) => {
    try {
      const currentMember = await getCurrentMemberOrThrow();
      const pending = await getPendingAccessForMember(currentMember._id);


      if (!pending) {
        return { ok: false, code: 'NO_PENDING_PAID_ACCESS' };
      }


      const schoolName = cleanText(input.schoolName, 180);
      const firstName = cleanText(input.firstName, 80);
      const lastName = cleanText(input.lastName, 80);
      const yearGroup = cleanText(input.yearGroup, 40);


      if (!schoolName || !firstName || !lastName) {
        return { ok: false, code: 'REQUIRED_SETUP_DETAILS_MISSING' };
      }


      if (pending.accessType === ACCESS_INDIVIDUAL && !yearGroup) {
        return { ok: false, code: 'REQUIRED_SETUP_DETAILS_MISSING' };
      }


      const config = await getCurrentConfig();

      const accessStartDate = pending.purchaseDate || new Date();

      const accessExpiryDate =
        pending.expiryDate ||
        config?.academicYearEndDate ||
        new Date('2027-06-30T12:00:00.000Z');


      if (pending.accessType === ACCESS_SCHOOL) {
        const existingSchoolResult = await wixData.query('Schools')
          .eq('primaryAdminMemberId', currentMember._id)
          .eq('academicYearLabel', pending.academicYearLabel)
          .limit(1)
          .find(READ_OPTIONS);


        let school = existingSchoolResult.items[0] || null;

        const schoolCode =
          school?.schoolCode ||
          await generateUniqueSchoolCode();

        const configuredSeatLimit =
          Math.max(Number(config?.schoolSeatLimit || 100), 1);

        const existingSeatAllowance =
          Number(school?.seatAllowance || 0);

        const seatAllowance =
          Math.max(existingSeatAllowance, configuredSeatLimit);


        if (school) {
          school = await wixData.update(
            'Schools',
            {
              ...school,
              schoolName,
              schoolCode,
              primaryAdminMemberId: currentMember._id,
              primaryContactEmail:
                currentMember.loginEmail ||
                school.primaryContactEmail ||
                '',
              subscriptionStatus: ACTIVE,
              subscriptionType: ACCESS_SCHOOL,
              startDate: accessStartDate,
              expiryDate: accessExpiryDate,
              academicYearLabel: pending.academicYearLabel,
              seatAllowance,
              extraSeatAllowance: Number(school.extraSeatAllowance || 0),
              pricingPlanId: pending.planId,
              orderId: pending.orderId,
              renewalReminderSent: false,
              renewalReminderSentDate: null
            },
            WRITE_OPTIONS
          );
        } else {
          school = await wixData.insert(
            'Schools',
            {
              schoolName,
              schoolCode,
              primaryAdminMemberId: currentMember._id,
              primaryContactEmail: currentMember.loginEmail || '',
              subscriptionStatus: ACTIVE,
              subscriptionType: ACCESS_SCHOOL,
              startDate: accessStartDate,
              expiryDate: accessExpiryDate,
              academicYearLabel: pending.academicYearLabel,
              seatAllowance,
              seatsUsed: 0,
              extraSeatAllowance: 0,
              pricingPlanId: pending.planId,
              orderId: pending.orderId,
              renewalReminderSent: false,
              renewalReminderSentDate: null
            },
            WRITE_OPTIONS
          );
        }


        await saveMemberEntitlement(currentMember._id, {
          schoolId: school._id,
          schoolName,
          firstName,
          lastName,
          email: currentMember.loginEmail || '',
          yearGroup,
          role: ROLE_ADMIN,
          status: ACTIVE,
          accessType: ACCESS_SCHOOL,
          accessStartDate,
          accessExpiryDate,
          academicYearLabel: pending.academicYearLabel,
          pricingPlanId: pending.planId,
          orderId: pending.orderId
        });


        const seatsAfter = await syncSchoolSeatCount(school);


        pending.schoolName = schoolName;
        pending.firstName = firstName;
        pending.lastName = lastName;
        pending.yearGroup = yearGroup;
        pending.status = 'COMPLETED';
        pending.setupCompletedDate = new Date();


        await wixData.update('PendingAccess', pending, WRITE_OPTIONS);


        await logAccessEvent({
          eventType: 'SCHOOL_ACCESS_ACTIVATED',
          schoolId: school._id,
          memberId: currentMember._id,
          academicYearLabel: pending.academicYearLabel,
          newStatus: ACTIVE,
          seatsBefore: Math.max(seatsAfter - 1, 0),
          seatsAfter,
          orderId: pending.orderId,
          pricingPlanId: pending.planId,
          source: 'PAID_SETUP'
        });


        return {
          ok: true,
          accessType: ACCESS_SCHOOL,
          schoolName,
          schoolCode,
          expiryDate: accessExpiryDate
        };
      }


      if (pending.accessType === ACCESS_INDIVIDUAL) {
        await saveMemberEntitlement(currentMember._id, {
          schoolId: null,
          schoolName,
          firstName,
          lastName,
          email: currentMember.loginEmail || '',
          yearGroup,
          role: ROLE_STUDENT,
          status: ACTIVE,
          accessType: ACCESS_INDIVIDUAL,
          accessStartDate,
          accessExpiryDate,
          academicYearLabel: pending.academicYearLabel,
          pricingPlanId: pending.planId,
          orderId: pending.orderId
        });


        pending.schoolName = schoolName;
        pending.firstName = firstName;
        pending.lastName = lastName;
        pending.yearGroup = yearGroup;
        pending.status = 'COMPLETED';
        pending.setupCompletedDate = new Date();


        await wixData.update('PendingAccess', pending, WRITE_OPTIONS);


        await logAccessEvent({
          eventType: 'INDIVIDUAL_ACCESS_ACTIVATED',
          memberId: currentMember._id,
          academicYearLabel: pending.academicYearLabel,
          newStatus: ACTIVE,
          orderId: pending.orderId,
          pricingPlanId: pending.planId,
          source: 'PAID_SETUP'
        });


        return {
          ok: true,
          accessType: ACCESS_INDIVIDUAL,
          schoolName,
          expiryDate: accessExpiryDate
        };
      }


      return {
        ok: false,
        code: 'INVALID_PENDING_ACCESS_TYPE'
      };
    } catch (error) {
      console.error('completePaidAccessSetup failed:', error);
      return { ok: false, code: 'UNEXPECTED_ERROR' };
    }
  }
);