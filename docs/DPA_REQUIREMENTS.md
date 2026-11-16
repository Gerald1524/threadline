# Data processing agreement — topics for counsel

A checklist for qualified legal review. This is not legal advice or a draft agreement.

1. **Roles.** Customer (property manager / owner-operator) as controller or "business";
   Threadline as processor or "service provider". Confirm per jurisdiction.
2. **Ownership.** Customer retains ownership of the records it contributes and of derived
   records (events, cases, packets). Threadline gets a limited license to process for the service.
3. **Purpose limitation.** Operational recordkeeping for incidents and requests. Explicitly
   excluded: employee productivity, attendance or performance monitoring; resident profiling;
   automated adverse housing or employment decisions; use of customer data to train models.
4. **Categories of data and data subjects.** Residents, employees, contractors, visitors;
   contact details, unit, complaint content, shift attribution; possible special-category
   content inside free text (health, accommodation, legal).
5. **Subprocessors.** Cloud host, database, object storage, and any AI, transcription or email
   provider enabled by the customer. List, notice period for changes, objection right.
6. **AI processing.** Which providers may receive which record classes; no training on customer
   data; provider retention terms disclosed per endpoint; no silent provider substitution.
7. **Security measures.** Encryption in transit and at rest, access control, audit logging,
   tenant isolation, secret management, backup and recovery, vulnerability management.
8. **Confidentiality** of personnel and subprocessors.
9. **Data subject requests.** Assistance with statutory access, correction or deletion requests
   where such rights apply; the customer decides and instructs.
10. **Retention and deletion.** Customer-configured retention; legal holds; deletion on
    instruction and at termination, including derived data and backups within a stated period;
    certificate of deletion.
11. **Export and exit.** Machine-readable export with source manifest; transition assistance.
12. **Incident response.** Notification without undue delay and within a stated number of
    hours; content of the notice; cooperation; allocation of breach-notification duties
    (e.g. NY GBL § 899-aa / SHIELD Act).
13. **Location and transfers.** Hosting region; cross-border transfer mechanism if any.
14. **Audit rights** and security documentation (e.g. SOC 2 when available).
15. **Law-enforcement and legal requests.** Notice to customer where lawful; narrow disclosure.
16. **Liability, indemnity, insurance** for data incidents.
17. **Voice.** If server-side transcription is enabled: audio handling, non-retention, and any
    recording-notice obligations assessed by counsel.
18. **Workplace notice.** Counsel to assess whether any employee notice is required given the
    final feature set (e.g. NY Civil Rights Law § 52-c*2), even though monitoring is not a purpose.
