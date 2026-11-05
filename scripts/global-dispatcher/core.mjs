// Stable primitives for all ASI product routes. No product imports or effects.
import {createHash} from 'node:crypto';
export const must=(value,code)=>{if(!value)throw Error(code);};
export const hash=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
