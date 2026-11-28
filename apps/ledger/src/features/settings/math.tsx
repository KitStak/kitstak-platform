/** "How Ledger does the math" (docs/ledger/SPEC.md 4.1): the plain words page. */
const POINTS: readonly string[] = [
  'An invoice asks a customer to pay for work. Each line is a quantity times a price. Sales tax is added line by line when you charge it.',
  'When you send an invoice, it gets its number and counts as money owed to you. A draft counts for nothing.',
  'A payment lowers what a customer owes. One payment can pay several invoices, or part of one.',
  'A credit note takes money off what a customer owes, for example for one wrong line.',
  'A bill is what a vendor asks you to pay. It counts as money you owe once it is approved.',
  'An expense is money already spent, on a company card or by a person you will pay back.',
  'Matching to the bank proves that each deposit and each payment out really happened.',
  'Closing a month locks it. Nothing dated in it can change unless the owner reopens it and says why.',
  'Behind every screen is one set of books: each thing that counts writes an entry where what goes in equals what goes out, to the cent. You never need to look at it. Your accountant can.',
  'Money is kept in whole cents and rounded once per line, half away from zero. Totals are plain sums of their lines, so they never drift.',
];

export function MathPage() {
  return (
    <ul className="flex list-disc flex-col gap-2 pl-5 text-base text-fg-secondary" data-testid="math-page">
      {POINTS.map((point) => (
        <li key={point}>{point}</li>
      ))}
    </ul>
  );
}
