import {describe,it,expect} from 'vitest';
import {validatePublicWebIntakePayload} from '../real-booking-intake-autopilot';
describe('Task32 public intake input boundary',()=>{
 it.each([null,[],false,12,'x'])('rejects non-object %j without throwing',value=>{
  expect(validatePublicWebIntakePayload(value as never)).toEqual(expect.any(String));
 });
 it('accepts a descriptive unbound inquiry',()=>expect(validatePublicWebIntakePayload({guestName:'Synthetic',propertyLabel:'Synthetic property'})).toBeNull());
 it.each(['accountId','propertyId','ownerId','metadata'])('rejects authoritative field %s',key=>{
  expect(validatePublicWebIntakePayload({guestName:'Synthetic',propertyLabel:'Synthetic property',[key]:'forged'})).toEqual(expect.any(String));
 });
});
