import type { SystemeBookingPayload, NormalisedBooking } from './types';

function normalisePhone(raw: string | undefined): string | null {
  if (!raw) return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;
  // Strip non-digits except leading +
  const cleaned = trimmed.replace(/[^\d+]/g, '');
  if (!cleaned) return null;
  // Assume UK if 11 digits starting with 0
  if (/^0\d{10}$/.test(cleaned)) return '+44' + cleaned.substring(1);
  // Already has country code without +
  if (/^\d{11,15}$/.test(cleaned) && !cleaned.startsWith('+')) return '+' + cleaned;
  return cleaned;
}

function deriveEventType(tagName: string | null): 'masterclass' | 'unknown' {
  if (!tagName) return 'unknown';
  if (tagName.toLowerCase() === 'masterclass') return 'masterclass';
  return 'unknown';
}

export function normaliseSystemeBooking(payload: SystemeBookingPayload): NormalisedBooking {
  const tag = payload.orderItem.resources[0]?.tag ?? null;

  return {
    attendee: {
      email: payload.customer.email.trim().toLowerCase(),
      firstName: (payload.customer.fields.first_name ?? '').trim(),
      lastName: (payload.customer.fields.surname ?? '').trim(),
      phone: normalisePhone(payload.customer.fields.phone_number),
      systemeContactId: payload.customer.contactId,
      systemeCustomerId: payload.customer.id,
    },
    booking: {
      externalBookingId: String(payload.order.id),
      ticketType: payload.pricePlan.name,
      eventType: deriveEventType(tag?.name ?? null),
    },
    payment: {
      externalPaymentId: String(payload.order.id),
      amountGross: payload.order.totalPrice,
      currency: payload.pricePlan.currency.toLowerCase(),
      paidAt: payload.order.createdAt,
    },
    meta: {
      funnelName: payload.funnelStep.funnel.name,
      funnelStepName: payload.funnelStep.name,
      tagName: tag?.name ?? null,
      sourceUrl: payload.customer.sourceUrl,
    },
  };
}
