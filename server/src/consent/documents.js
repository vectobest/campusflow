/**
 * Versioned informed-consent documents. A participant's consent is tied to the
 * exact version they accepted; when the text changes, bump the version so that
 * existing participants must re-consent before starting new sessions.
 *
 * Fields marked TODO must be completed by the study team (e.g. after
 * institutional ethics review) before real data collection begins.
 */
export const consentDocuments = {
  '1.0': {
    version: '1.0',
    title: 'CampusFlow — Informed Consent for Campus Mobility Research',
    studyContact: process.env.STUDY_CONTACT || 'TODO: principal investigator name and email',
    ethicsApproval: process.env.ETHICS_APPROVAL_REF || 'TODO: institutional approval reference (pending)',
    sections: [
      {
        heading: 'Purpose',
        body:
          'CampusFlow studies aggregate movement patterns around the NIT Raipur campus: frequently used routes, places where people commonly stop, and how activity changes over the day. The study is about groups, not individuals. It is not used to monitor, evaluate, or discipline anyone.',
      },
      {
        heading: 'What is collected',
        body:
          'Only while you have an active collection session: timestamp, latitude, longitude, and — when your device provides them — reported accuracy, speed, and heading. We also record session start/stop/pause times and a coarse device form factor (phone or desktop). We do not collect your contacts, device identifiers, or location outside an active session.',
      },
      {
        heading: 'How collection works',
        body:
          'Collection runs only while the CampusFlow page is open and a session is active. A visible indicator shows when recording is on. You can pause or stop at any time. Ordinary web pages cannot reliably record in the background, so recording may stop if you lock your screen or switch apps.',
      },
      {
        heading: 'How your data is protected',
        body:
          'Your account (email) is stored separately from your research identifier. Raw location traces are accessible only to you and to authorised researchers. Published results are aggregated, and results based on too few participants are suppressed. Removing your name does not make location traces anonymous, so raw traces are never published.',
      },
      {
        heading: 'Retention and deletion',
        body:
          'Raw traces are deleted automatically after the configured retention period. You can delete any of your sessions, or all of your data, at any time from the "My data" page. Aggregate results that were already published cannot be retracted, but they never contain your individual trajectory.',
      },
      {
        heading: 'Voluntary participation',
        body:
          'Participation is voluntary. You may withdraw consent at any time without giving a reason and without any consequence. Withdrawing stops all collection; you can also choose to delete your contributed data.',
      },
    ],
    statements: [
      'I have read and understood the information above.',
      'I agree that my location will be recorded only during sessions I start, and only while the page is open.',
      'I understand that I can pause, stop, delete my data, or withdraw at any time.',
    ],
  },
};

export function getConsentDocument(version) {
  return consentDocuments[version] || null;
}
