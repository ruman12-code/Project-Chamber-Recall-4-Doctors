// Photographs of paper, as the screens see them. The bytes never
// travel with this: a list of forty pictures would be forty
// megabytes crossing the bridge to draw a screen of thumbnails.
export type AttachmentKind = 'report' | 'prescription_scan' | 'old_paper_file' | 'image';

export interface AttachmentView {
  id: string;
  patientId: string;
  visitId: string | null;
  kind: AttachmentKind;
  caption: string | null;
  documentDate: string | null;
  capturedAt: string;
  byteSize: number;
  contentType: string;
  width: number | null;
  height: number | null;
  source: string;
  addedByName: string | null;
  visitDate: string | null;
}

/** What each kind is called on screen. */
export const KIND_LABEL: Record<AttachmentKind, { en: string; bn: string }> = {
  report: { en: 'Test report', bn: 'রিপোর্ট' },
  prescription_scan: { en: 'Old prescription', bn: 'পুরোনো ব্যবস্থাপত্র' },
  old_paper_file: { en: 'Paper file', bn: 'পুরোনো কাগজ' },
  image: { en: 'Other picture', bn: 'অন্য ছবি' },
};
