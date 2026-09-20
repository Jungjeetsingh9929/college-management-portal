// Returns holidays that fall strictly after today and within the next
// `windowDays` days (inclusive of the end of the window), sorted by date.
export function getUpcomingHolidays(holidays, windowDays = 7) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const windowEnd = new Date(today);
  windowEnd.setDate(windowEnd.getDate() + windowDays);

  return (holidays || [])
    .filter((holiday) => {
      const holidayDate = new Date(holiday.date);
      holidayDate.setHours(0, 0, 0, 0);
      return holidayDate > today && holidayDate <= windowEnd;
    })
    .sort((a, b) => new Date(a.date) - new Date(b.date));
}
