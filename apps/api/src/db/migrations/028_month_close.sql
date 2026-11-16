-- Month close (client, 17 Nov 2026): a month stays open for 10 days after it ends (late payments dated in it still
-- count there), then it is final. At the close each person's month pay is saved as it was, and every screen shows
-- that saved copy from then on. Payments dated in a closed month that show up later are listed, never added.
CREATE TABLE IF NOT EXISTS months_closed (
  month      CHAR(7) PRIMARY KEY,                 -- 'YYYY-MM'
  closed_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS month_close (
  month       CHAR(7) NOT NULL REFERENCES months_closed (month) ON DELETE CASCADE,
  employee_id UUID NOT NULL REFERENCES employees (id) ON DELETE CASCADE,
  pay         JSONB NOT NULL,                     -- the month's pay as every screen showed it at the close
  PRIMARY KEY (month, employee_id)
);
CREATE TABLE IF NOT EXISTS late_payments (
  month       CHAR(7) NOT NULL,
  employee_id UUID NOT NULL REFERENCES employees (id) ON DELETE CASCADE,
  payment_id  VARCHAR(120) NOT NULL,
  paid_date   DATE NOT NULL,
  amount      NUMERIC(12, 2) NOT NULL,
  commission  NUMERIC(12, 2) NOT NULL,
  found_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (employee_id, payment_id)
);
