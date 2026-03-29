// ─── Incident Domain Types ────────────────────────────────────────────────────

export type IncidentSource =
  | 'cleaner'
  | 'owner'
  | 'noise_sensor'
  | 'smoke_sensor'
  | 'door_sensor'
  | 'guest_message';

export type IncidentType =
  | 'damage'
  | 'excessive_mess'
  | 'party_suspected'
  | 'smoking_suspected'
  | 'noise_violation'
  | 'unauthorized_access';

export type ContactStrategy =
  | 'none'
  | 'soft_notice'
  | 'operator_review'
  | 'ota_only';

export interface IncidentRecord {
  incidentId: string;
  propertyId: string;
  reservationRef?: string;
  source: IncidentSource;
  type: IncidentType;
  severity: 'low' | 'medium' | 'high';
  evidenceStatus: 'pending' | 'collected' | 'insufficient';
  contactStrategy: ContactStrategy;
  otaCaseRequired: boolean;
  directGuestSensitive: boolean;
  createdAt: string;
}

// ─── Cleaner Issue Report ─────────────────────────────────────────────────────

export interface CleanerIssueReportInput {
  propertyId: string;
  reservationRef?: string;
  reportedBy: 'cleaner';
  issueType: 'damage' | 'excessive_mess' | 'party_suspected' | 'smoking_suspected';
  severity: 'low' | 'medium' | 'high';
  notes?: string;
  photoUrls?: string[];
  videoUrls?: string[];
  reportedAt: string;
}

// ─── Property Configuration Types ────────────────────────────────────────────

export interface PropertyCapabilities {
  smartLock: boolean;
  noiseSensor: boolean;
  smokeSensor: boolean;
  doorSensor: boolean;
  brandedKitLevel: 'basic' | 'standard' | 'full';
}

export interface PropertyBrandProfile {
  brandTier: 'entry' | 'standard' | 'signature';
  wifiStandardized: boolean;
  lockStandardized: boolean;
  safetyKitInstalled: boolean;
  evidenceProtocolEnabled: boolean;
  guestbookStandardized: boolean;
  amenitiesStandardized: boolean;
}
