import {describe,expect,it} from 'vitest';
import {classifyDeliveryError,parseTelegramDeliveryReceipt} from '../src/telegram-delivery.js';

describe('Telegram delivery receipts',()=>{
 it('requires a positive platform id bound to the intended destination',async()=>{
  await expect(parseTelegramDeliveryReceipt(JSON.stringify({success:true,platform:'telegram',chat_id:'-10042',message_id:'42'}),'telegram:-10042')).resolves.toMatchObject({platform:'telegram',platformReceiptId:'42',target:'telegram:-10042'});
  await expect(parseTelegramDeliveryReceipt(`plugin loaded\n${JSON.stringify({success:true,platform:'telegram',chat_id:'-10042',message_thread_id:7,message_id:'43',mirrored:true})}`,'telegram:-10042:7')).resolves.toMatchObject({platformReceiptId:'43',target:'telegram:-10042:7'});
  await expect(parseTelegramDeliveryReceipt(JSON.stringify({success:true,platform:'telegram',chat_id:'-10043',message_id:'44'}),'telegram:-10042')).rejects.toThrow('invalid_receipt');
  await expect(parseTelegramDeliveryReceipt(JSON.stringify({success:true,platform:'telegram',chat_id:'-10042',message_id:'45'}),'telegram:-10042:7')).rejects.toThrow('invalid_receipt');
  await expect(parseTelegramDeliveryReceipt(JSON.stringify({success:true,platform:'telegram',chat_id:'-10042',message_thread_id:7,message_id:'46'}),'telegram:-10042')).rejects.toThrow('invalid_receipt');
  for(const value of [{},{success:false,platform:'telegram',message_id:'1'},{success:true,platform:'telegram'},{success:true,platform:'telegram',message_id:0},{success:true,platform:'telegram',result:{message_id:4}},{success:true,platform:'telegram',message_id:'4',secret:'leak'}])await expect(parseTelegramDeliveryReceipt(JSON.stringify(value),'telegram:-10042')).rejects.toThrow('invalid_receipt');
 });
 it('classifies bounded delivery failures without leaking provider text',()=>{
  expect(classifyDeliveryError(new Error('request timed out'))).toBe('gateway_timeout');
  expect(classifyDeliveryError(new Error('invalid_receipt'))).toBe('invalid_receipt');
  expect(classifyDeliveryError(new Error('socket disconnected after side effect'))).toBe('gateway_unavailable');
 });
});
