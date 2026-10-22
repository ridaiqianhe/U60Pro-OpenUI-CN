const {test}=require('node:test')
const assert=require('node:assert/strict')
const {loadTs}=require('./ts-loader.cjs')
const {parseSmsDate,formatSmsDate}=loadTs('features/modem/smsDate.ts')
test('WMS comma timestamps render GSM timezone quarter-hours correctly',()=>{
 assert.equal(parseSmsDate('26,08,11,21,35,49,+32').toISOString(),'2026-08-11T13:35:49.000Z')
 assert.equal(formatSmsDate('26,08,11,21,35,49,+32'),'2026-08-11 21:35:49')
 assert.equal(formatSmsDate('26,08,11,01,35,49,-16'),'2026-08-11 13:35:49')
})
test('agent semicolon timestamps and ISO retain timezone meaning',()=>{
 assert.equal(formatSmsDate('26;08;11;21;35;49;+8'),'2026-08-11 21:35:49')
 assert.equal(formatSmsDate('26;08;11;21;35;49;+32'),'2026-08-11 21:35:49')
 assert.equal(formatSmsDate('2026-08-11T13:35:49Z'),'2026-08-11 21:35:49')
})
test('malformed dates stay visible and are never silently rolled over',()=>{
 for(const raw of ['26,02,30,21,35,49,+32','26,13,11,21,35,49,+32','26,08,11,24,35,49,+32','bad']) assert.equal(formatSmsDate(raw),raw)
 assert.equal(formatSmsDate(undefined),'')
})
