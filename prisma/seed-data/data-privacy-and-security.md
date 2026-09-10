# Data Privacy and Security Standard

Version 5.0 · Owner: Security & Compliance · Last reviewed: 28 February

## 1. What counts as personal data

Names, email addresses, phone numbers, delivery addresses, payment references and support
conversation transcripts are all personal data. Order contents are personal data when they can
be linked to an individual.

## 2. Access rules

Access follows least privilege. Operators see only the customers they are working with through
the FlowPilot interface. Direct database access is restricted to the platform team and is
logged.

The AI operations agent never queries the database directly. It can only call the reviewed,
typed tools exposed to it, and every call is recorded in the audit log with its arguments,
its result and the identity of the human on whose behalf it acted.

## 3. Retention

- Support conversations: 24 months.
- Order records: 7 years, for tax purposes.
- Audit logs: 24 months.
- Uploaded knowledge documents: retained until deleted by an administrator.

## 4. Customer data requests

A customer may request a copy of their data or its deletion. Verify identity against the email
on the account before acting. Deletion requests are completed within 30 days; order records
required for tax purposes are retained but anonymised.

## 5. Sharing with third parties

Customer data is shared only with the carrier (delivery address and phone), the payment
processor (payment reference), and the email provider (email address). No customer data is
used to train external models.

## 6. Incident response

Report a suspected data incident within one hour to the security duty contact. Do not discuss
a suspected incident with the customer until the security team has confirmed the facts.

## 7. Credentials

API keys and database credentials live only in environment variables and the secrets manager.
They are never written into documents, tickets, source code or chat messages. A credential
that appears in a support ticket must be treated as compromised and rotated the same day.
