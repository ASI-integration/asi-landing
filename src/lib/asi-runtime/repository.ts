import { supabase } from '@/lib/supabase';
import { RUNTIME_SNAPSHOT_SELECT_COLUMNS } from './public-status';
import type { AsiRuntimeSnapshotRow } from './types';

export async function getRuntimeSnapshotForUser(userId: string): Promise<AsiRuntimeSnapshotRow | null> {
  const id = userId.trim();
  if (!id) return null;

  const { data, error } = await supabase
    .from('asi_runtime_snapshots')
    .select(RUNTIME_SNAPSHOT_SELECT_COLUMNS)
    .eq('user_id', id)
    .maybeSingle();

  if (error) throw new Error(error.message);
  if (!data) return null;
  return data as AsiRuntimeSnapshotRow;
}
