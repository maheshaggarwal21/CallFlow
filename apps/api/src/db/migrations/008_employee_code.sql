-- MIGRATION 008 — Human-readable employee ID ("Employee Id: 1001" in reports)
-- Existing employees are numbered from 1001 in the order they were created;
-- new ones take the next number automatically. Re-runnable: migrate.ts applies
-- every file on every run, so each step is guarded.

CREATE SEQUENCE IF NOT EXISTS employees_employee_code_seq START WITH 1001;
ALTER TABLE employees ADD COLUMN IF NOT EXISTS employee_code INTEGER;
ALTER SEQUENCE employees_employee_code_seq OWNED BY employees.employee_code;

UPDATE employees e
SET employee_code = n.code
FROM (
  SELECT id,
         (SELECT COALESCE(MAX(employee_code), 1000) FROM employees)
           + ROW_NUMBER() OVER (ORDER BY created_at, id) AS code
  FROM employees
  WHERE employee_code IS NULL
) n
WHERE e.id = n.id;

SELECT setval('employees_employee_code_seq',
              GREATEST((SELECT MAX(employee_code) FROM employees), 1000));

ALTER TABLE employees ALTER COLUMN employee_code SET DEFAULT nextval('employees_employee_code_seq');
ALTER TABLE employees ALTER COLUMN employee_code SET NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS employees_employee_code_key ON employees (employee_code);
