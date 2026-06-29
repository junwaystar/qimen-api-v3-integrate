import { Solar, Lunar } from 'lunar-javascript';

export interface BaziResult {
  solarDate: string;
  lunarDate: string;
  yearPillar: string;
  monthPillar: string;
  dayPillar: string;
  hourPillar: string;
  fullBazi: string;
  isLeap: boolean;
  isTimeUnknown: boolean;
}

export class CalendarService {
  /**
   * 寬容度日期解析
   * 支持格式: 1981-8-13 10:30, 1981/08/13 10:30, 1981-8-13 吉時, 1981-8-13 (無時間)
   */
  static parseDateTime(input: string) {
    const datePartMatch = input.match(/(\d{4})[-./\s](\d{1,2})[-./\s](\d{1,2})/);
    if (!datePartMatch) return null;

    const year = parseInt(datePartMatch[1]);
    const month = parseInt(datePartMatch[2]);
    const day = parseInt(datePartMatch[3]);

    let hour = 0;
    let minute = 0;
    let isTimeUnknown = true;

    if (input.includes("吉時")) {
      isTimeUnknown = true;
    } else {
      const timeMatch = input.match(/(\d{1,2})[:時](\d{2})(?:分)?/);
      if (timeMatch) {
        hour = parseInt(timeMatch[1]);
        minute = parseInt(timeMatch[2]);
        isTimeUnknown = false;
      }
    }

    return { year, month, day, hour, minute, isTimeUnknown };
  }

  /**
   * 將太陽曆時間轉換為八字排盤
   */
  static calculateBazi(year: number, month: number, day: number, hour: number, minute: number, isTimeUnknown: boolean): BaziResult {
    const solar = Solar.fromYmdHms(year, month, day, hour, minute, 0);
    const lunar = solar.getLunar();
    const eightChar = lunar.getEightChar();

    const yearP = eightChar.getYear();
    const monthP = eightChar.getMonth();
    const dayP = eightChar.getDay();
    const hourP = isTimeUnknown ? "吉時" : eightChar.getTime();

    return {
      solarDate: solar.toString(),
      lunarDate: lunar.toString(),
      yearPillar: yearP,
      monthPillar: monthP,
      dayPillar: dayP,
      hourPillar: hourP,
      fullBazi: `${yearP} ${monthP} ${dayP} ${hourP}`,
      // FIX: Replace getLeap() which caused the crash with isLeap()
      isLeap: lunar.isLeap ? lunar.isLeap() : false,
      isTimeUnknown: isTimeUnknown,
    };
  }
}
