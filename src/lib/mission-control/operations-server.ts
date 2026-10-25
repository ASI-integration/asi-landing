import 'server-only';
import release from '../../../docs/agent-os/releases/strigunov4-demo.json';
import { readOperations } from './operations-store';
import { OPERATIONS_SCHEMA, operationCard, type OperationCard, type OperationsSnapshot } from './operations';
export async function getOperationsSnapshot(): Promise<OperationsSnapshot> {
  const now = Date.now(), stored = await readOperations();
  const stage = release.stages.find(s => s.id === 'S4-G2');
  const hold: OperationCard = {id:'strigunov-g2',title:'Стригунов 4 / G2',product:'Стригунов 4',status:'HOLD',
    sourceUpdatedAt:null,observedAt:null,process:'UNKNOWN',task:'IDLE',completed:null,total:null,bytes:null,totalBytes:null,errors:null,archives:[],
    detail:'Работы G2 приостановлены по решению владельца. Панель не возобновляет их. Критерии — из канонической карты установленной версии сайта.',
    nextStep:'Оставить G2 на HOLD до отдельного решения владельца.',criteria:stage?.acceptance ?? []};
  return {schemaVersion:OPERATIONS_SCHEMA,fetchedAt:new Date(now).toISOString(),cards:[operationCard('backup-gh',stored,now),hold,operationCard('server-backups',stored,now),operationCard('runtime-worker',stored,now)]};
}
