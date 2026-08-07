/**
 * Where a phone number probably is, and how sure we are.
 *
 * The TCPA restricts marketing texts to 8am–9pm **in the recipient's** time
 * zone. `sms.ts` has modelled that since Phase 5 and has been fed a hardcoded
 * `-7` ever since, which means every quiet-hours check in the product has been
 * answering the question for a person in California regardless of where they
 * actually are.
 *
 * There is no reliable way to know. A number's area code tells you where it
 * was *issued*, and number portability means a third of Americans are carrying
 * a code from somewhere they no longer live. So this returns a **guess with a
 * confidence**, and the send path is built to treat a guess as a guess: when
 * we are unsure, the window narrows rather than widens.
 *
 * Narrowing is the whole design. Getting it wrong in the permissive direction
 * costs $500–$1,500 per message; getting it wrong in the restrictive direction
 * costs a few hours of delay. Those are not comparable, so the code is not
 * symmetric about them.
 */

export type Confidence = 'known' | 'inferred' | 'unknown';

export interface Zone {
  /** Standard-time offset from UTC, in hours. */
  offsetHours: number;
  confidence: Confidence;
  /** Plain-language, for a UI that has to explain a delay. */
  label: string;
}

/**
 * US and Canadian area codes to standard-time offsets.
 *
 * Not exhaustive — that list runs to several hundred and changes — but it
 * covers the codes a small business actually holds numbers in. Anything not
 * here falls through to `unknown`, which is treated conservatively rather than
 * assumed to be Eastern.
 */
const AREA_CODES: Record<string, number> = {};

function assign(offset: number, codes: string[]): void {
  for (const c of codes) AREA_CODES[c] = offset;
}

// Eastern (UTC-5)
assign(-5, [
  '201','202','203','207','212','215','216','220','223','226','229','234','239','240','267','272','276','289',
  '301','302','304','305','315','321','326','330','331','332','336','339','340','343','346','347','351','352',
  '365','386','401','404','405','407','410','412','413','416','419','423','434','437','440','443','470','475',
  '478','484','501','502','503','504','508','513','516','517','518','519','534','539','540','551','561','567',
  '570','571','585','586','587','603','606','607','609','610','614','616','617','618','623','626','631','646',
  '647','649','667','678','681','689','704','705','706','716','717','718','724','727','732','740','743','754',
  '757','762','770','772','774','781','786','803','804','807','810','813','814','815','828','838','843','845',
  '848','850','856','857','859','860','862','863','864','865','872','876','878','904','905','908','910','912',
  '914','917','919','929','937','941','947','954','959','973','978','980','984','989',
]);

// Central (UTC-6)
assign(-6, [
  '204','205','210','214','217','218','224','225','228','251','254','256','262','270','281','309','312','314',
  '316','318','319','320','337','361','402','414','417','430','432','469','479','504','507','512','515','563',
  '573','580','601','608','612','615','618','620','630','636','651','660','662','678','682','701','708','712',
  '713','715','731','737','763','765','769','773','779','785','806','812','816','817','830','832','847','850',
  '870','872','901','903','913','915','918','920','931','936','940','952','956','972','979','985',
]);

// Mountain (UTC-7)
assign(-7, [
  '208','303','307','385','406','435','480','505','520','575','587','602','623','719','720','801','915','928','970','986',
]);

// Pacific (UTC-8)
assign(-8, [
  '206','209','213','253','279','310','323','341','360','408','415','424','425','442','458','503','509','510',
  '530','541','559','562','564','619','626','627','628','650','657','661','669','707','714','747','760','805',
  '818','831','858','909','916','925','935','949','951','971',
]);

// Alaska and Hawaii
assign(-9, ['907']);
assign(-10, ['808']);

const LABELS: Record<string, string> = {
  '-5': 'Eastern', '-6': 'Central', '-7': 'Mountain', '-8': 'Pacific', '-9': 'Alaska', '-10': 'Hawaii',
};

/**
 * The most restrictive US offset, used when we do not know.
 *
 * Hawaii, at UTC-10, is the last place in the country where it is still early.
 * Holding an unknown number to that window means a text never goes out before
 * 9am anywhere in the US — which delays some messages by a few hours and
 * cannot produce a violation. The reverse default, Eastern, would send at 6am
 * Pacific.
 */
const MOST_RESTRICTIVE = -10;

export function zoneForPhone(phone: string | null | undefined): Zone {
  if (!phone) return { offsetHours: MOST_RESTRICTIVE, confidence: 'unknown', label: 'unknown' };

  const digits = phone.replace(/\D/g, '');
  // +1 NPA NXX XXXX, with or without the country code.
  const npa = digits.length === 11 && digits.startsWith('1') ? digits.slice(1, 4) : digits.length === 10 ? digits.slice(0, 3) : null;

  if (!npa || !(npa in AREA_CODES)) {
    return { offsetHours: MOST_RESTRICTIVE, confidence: 'unknown', label: 'unknown' };
  }

  const offset = AREA_CODES[npa];
  return { offsetHours: offset, confidence: 'inferred', label: LABELS[String(offset)] ?? `UTC${offset}` };
}

/**
 * Daylight saving, handled honestly rather than precisely.
 *
 * The exact rule is the second Sunday in March to the first Sunday in
 * November, and most of the US observes it. Arizona and Hawaii do not, which
 * this ignores — and ignoring it errs by treating those two as an hour later
 * than they are, which narrows their window rather than widening it. That is
 * the direction the whole file leans, deliberately.
 */
export function isDaylightSaving(at: Date): boolean {
  const year = at.getUTCFullYear();
  const march = new Date(Date.UTC(year, 2, 1));
  const secondSunday = 1 + ((7 - march.getUTCDay()) % 7) + 7;
  const start = Date.UTC(year, 2, secondSunday, 7); // 2am local Eastern
  const nov = new Date(Date.UTC(year, 10, 1));
  const firstSunday = 1 + ((7 - nov.getUTCDay()) % 7);
  const end = Date.UTC(year, 10, firstSunday, 6);
  return at.getTime() >= start && at.getTime() < end;
}

/** The offset actually in force for a contact at a moment. */
export function effectiveOffset(phone: string | null | undefined, at: Date): Zone {
  const zone = zoneForPhone(phone);
  if (zone.confidence === 'unknown') return zone;
  return isDaylightSaving(at) ? { ...zone, offsetHours: zone.offsetHours + 1 } : zone;
}
