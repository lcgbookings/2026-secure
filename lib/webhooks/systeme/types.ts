export interface SystemeBookingPayload {
  customer: {
    id: number;
    clientIp: string | null;
    contactId: number;
    email: string;
    fields: {
      surname?: string;
      phone_number?: string;
      first_name?: string;
      postcode?: string;
      street_address?: string;
      city?: string;
    };
    paymentProcessor: string;
    sourceUrl: string;
  };
  coupon: unknown | null;
  funnelStep: {
    id: number;
    name: string;
    type: string;
    funnel: {
      id: number;
      name: string;
    };
  };
  checkoutPage: unknown | null;
  order: {
    id: number;
    createdAt: string;
    discountAmount: number | null;
    discountType: string | null;
    shippingFee: number | null;
    totalPrice: number;
    vat: number;
  };
  orderItem: {
    createdAt: string;
    id: number;
    resources: Array<{
      course: unknown | null;
      courseBundle: unknown | null;
      enrollmentAccessType: unknown | null;
      enrollmentDrippingAccessCourse: unknown | null;
      physicalProduct: unknown | null;
      tag: {
        id: number;
        name: string;
      } | null;
    }>;
  };
  pricePlan: {
    id: number;
    name: string;
    type: string;
    amount: number;
    currency: string;
    innerName: string;
    recurringOptions: unknown | null;
    statementDescriptor: string | null;
  };
}

export interface NormalisedBooking {
  attendee: {
    email: string;
    firstName: string;
    lastName: string;
    phone: string | null;
    systemeContactId: number;
    systemeCustomerId: number;
  };
  booking: {
    externalBookingId: string;
    ticketType: string;
    eventType: 'masterclass' | 'unknown';
  };
  payment: {
    externalPaymentId: string;
    amountGross: number;
    currency: string;
    paidAt: string;
  };
  meta: {
    funnelName: string;
    funnelStepName: string;
    tagName: string | null;
    sourceUrl: string;
  };
}
