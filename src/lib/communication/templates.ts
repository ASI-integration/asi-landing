/**
 * Property-level guest-facing message templates.
 *
 * Reads the 4 operator-settable template columns from tg_property_knowledge.
 * Returns null on any error (missing row, DB unavailable) so callers always
 * fall back to existing default behaviour.
 */

import { supabase } from '@/lib/supabase';

export interface PropertyTemplates {
  pre_checkin_template:    string | null;
  checkout_template:       string | null;
  followup_template:       string | null;
  escalation_contact_text: string | null;
}

/**
 * Fetch the template fields for a property.
 * Returns null when the property has no row, no templates set, or on any error.
 */
export async function getPropertyTemplates(propertyId: string): Promise<PropertyTemplates | null> {
  try {
    const { data, error } = await supabase
      .from('tg_property_knowledge')
      .select('pre_checkin_template, checkout_template, followup_template, escalation_contact_text')
      .eq('property_id', propertyId)
      .maybeSingle();

    if (error || !data) return null;

    const t: PropertyTemplates = {
      pre_checkin_template:    (data as Record<string, unknown>).pre_checkin_template    as string | null ?? null,
      checkout_template:       (data as Record<string, unknown>).checkout_template       as string | null ?? null,
      followup_template:       (data as Record<string, unknown>).followup_template       as string | null ?? null,
      escalation_contact_text: (data as Record<string, unknown>).escalation_contact_text as string | null ?? null,
    };

    // Return null when none of the 4 fields are actually set
    if (!t.pre_checkin_template && !t.checkout_template && !t.followup_template && !t.escalation_contact_text) {
      return null;
    }

    return t;
  } catch {
    return null;
  }
}
