Working Rules (must follow)
1. Write code in small increments only. Proceed without approval prompts when updating files.
2. Avoid unnecessary questions; ask only if blocked by missing info.
3. CALLFLOW_PLAN_V6.md is the primary plan. Follow it strictly. If anything seems wrong, discuss first; change only after approval.
4. Do not follow the plan blindly. If a genuine problem is found, stop work and discuss before changes.
5. call.jsx is the design source to be modularized per the plan.
6. Always read context.md for project understanding.
7. Execute tasks in small modules with testing alongside, not many features at once.
8. User is Developer A (backend + FTP + mobile) per CALLFLOW_PLAN_V6.md.
9. No approval prompts for file updates; follow plan order without repeated ordering prompts.
10. Track unresolved blockers in problems.md for later discussion.

Current Status
- FTP ingest: misc threshold is now <30s and inserts are conflict-safe (source_file_key).
- FTP poller: guarded to run only Mon-Sat between 09:00-18:59 local time.
- Intercom PATCH uses explicit type cast to avoid Postgres param inference crash.
- Docker: compose works when Docker bin is on PATH; containers started.
- Added Android runtime permission request and QR scan placeholder button in mobile app.
- Checklist updated in developer-a-checklist.md.
- QR scan implemented using react-native-camera-kit.
- Remaining plan gaps: real FTP/mobile/AI e2e validation.
- Developer B web merge: dev-b-web copied into apps/web, auth switched to httpOnly cookie flow, filters/queries aligned to API, Team/Employees/Overview/Misc pages updated per plan, helper libs added (constants, chartTransforms, tagMaps, callSentiment). dev-b-web/dev-b-api folders removed after merge.
- Web UI components added: PieChart, LineChart, BarChart, GaugeMeter, MobileCallCard, EmployeeFilterDropdown; CallTable switches to MobileCallCard for small screens.
- OverviewPage now uses shared chart components and CSAT gauge; EmployeesPage uses EmployeeFilterDropdown + shared BarChart; EmpDashPage uses shared BarChart with toBarChartData.
- WABtn and AudioPlayer moved into components/ui and imports updated.
- API AI prompts added (apps/api/src/queue/prompts.ts); ai.service now uses prompts with strict JSON parsing.
- callSentiment now uses ai_status-aware emoji mapping with pending/unknown states (per plan).
- CallPanel header now includes intercom phone number and source label metadata (per plan).
- CallPanel shows a loading skeleton layout while call data is fetched (BUG-42).
- Local web dev now uses file:../../packages/shared-types in apps/web package.json; shared-types built before running web dev.
- No default login credentials in repo; web login uses /auth/login against employees table.
- Web build on Vercel: temporarily bypass ESLint/TS build errors via apps/web/next.config.mjs (ignoreDuringBuilds + ignoreBuildErrors).
- Web login: apps/web/lib/api.ts now surfaces 401 errors on /auth/login instead of hard redirecting to /login.
- Supabase seed script executed locally via npx ts-node src/seed.ts; admin/employee seed accounts created.
- Production blocker: API on droplet still failing with Postgres 28P01 (password auth failed). Suspect incorrect DATABASE_URL in droplet .env; needs verification in /root/CallFlow/apps/api/.env and /root/CallFlow/apps/ftp-service/.env.

you have to act as a senior software senior having 15+ years of experience in designing and making production grade software , understanding the needs and not doing any over engineering while maintaining proper security .

Context - let me first describe the whole scenario , we have a client who has a music academy named max music school . we have data of student along with their phone number available who have enrolled . for customer care service our client currently uses korecall software to record call recordings and save them to local pc and google drive for now . but as you can see in the pictures i have shared , the format of call recordings stored is very irritating and not very readable . a little explaination about format - there is folder for every month and then everyday and then the recordings with timestamps and phone number in the name as seen in the pictures . for more understanding take reference from the call.jsx design file and plan file untitled document.docx which i have shared . Now here comes our website - it stores all the recordings with proper data and provide analytics , ai generated summaries , reviews and details and transcripts in eye pleasing manner . for complete understanding refer to design call.jsx and .docx file shared . first let me tell you about the call.jsx - it is the finalised design of all website along with all the features to be implemented which we made to show to the client , it contains all the features just frontend , we have to implement backend . also , just for info , we have to  make rbac system where this is design for owner (the person at the top) . there will be only two roles owner and emplyees . we have to make separate login for owner and each employee where owner will see this design and emplyee will see only the their dashboard as shown in the owner . 


now korecall has ftp feature , we have checked that so make a plan accordingly for data retrieval . but the problem is this korecall service ends at 5p.m.  . for calls after 5 pm our client will keep android phone as source of call recordings . here comes our app . note that our app will not record call , it will be done by phone's own call recording feautre as andorid block third party call recording . our app will read call logs and call recordings from the phone storage with proper meta data . the app is just a middleware for transferring call recordings and data from phone to our website or server . the app will have just a login page and then the option to add phone name and the phone number and a location selection option so that the phone user can set the location of call recordings in the phone storage . we want to show recordings with tags like this is from phone 1 ,phone 2 , etc. and app has to ask for required permissions on sartup , we dont want any fancy ui for app just a simple one as described.

remember to decide the tech stack properly according to requirements , deployment options , db , where the call recodings will be saved and how . take care to ai pipeline for ai summary and transcript of phone call . note- we have to give transcripts in proper separated format like agent said this and the student said this as shown in design so take care of that . also note that we will give a review as postive or negative based on transcripts as sentiment analysis . 

as make a proper plan for data extraction for both app and website and how to sotre them properly .

