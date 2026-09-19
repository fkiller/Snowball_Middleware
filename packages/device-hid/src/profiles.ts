import type { HidProfile } from './index.js';

export const mk20QmkProfile: HidProfile = {
  id: 'mk20-qmk-controller',
  vendorId: 0x4250,
  productId: 0x426f,
  selectors: [
    { platform: 'win32', interface: 3, usagePage: 65329, usage: 116, release: 256 },
    { platform: 'darwin', interface: 3, usagePage: 65329, usage: 116, release: 256 }
  ],
  report: {
    length: 32,
    reportId: 1,
    buttons: [
      { id: 'btn-1', offset: 1, mask: 1 },
      { id: 'btn-2', offset: 1, mask: 2 }
    ]
  },
  identificationButton: 'btn-1'
};

/** Reviewed and physically verified profiles. */
export const reviewedProfiles: readonly HidProfile[] = [mk20QmkProfile];
