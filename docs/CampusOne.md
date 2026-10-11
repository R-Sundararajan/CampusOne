### **CampusOne - A multi-purpose fullstacks college Application**

##### Campus One is a multi-purpose full stack web application for our college that handles attendance marking system, Event Management System and Complaint Management System within a single application. Students can access the application to view their attendance, look for events happening in our college and participate and raise complaints about any issues existing in the college premises. Staff can mark and view the attendance of the students and can raise complaints related to the issues prevailing around them.

#### The features included in this application:

1. Attendance Marking System
2. College Event Management System
3. Complaint Management System

#### The software is built with the help of the SSDLC Cycle:

1. Requirement phase
2. Design Phase
3. Development Phase
4. Testing Phase
5. Deployment Phase
6. Maintenance Phase

#### What are the issues with the current system/flow?

- Students use multiple applications (Email, WhatsApp, etc.,) and websites to know about the events happening in our college.
- They don't have system to know about their attendance for each subject.
- Complaint raising is still manual in hostels.

#### What CampusOne provides?

It acts as a centralized platform for students to know about their attendance, guide to events, and easier way to solve the issues prevailing inside the campus. They don't have to worry about missing classes or verifying proper attendance, they need not worry about missing events since the app provides information about current and upcoming events conducted in our college, and hassle-free way to sovle the issues around them.

#### Scope:

##### In Scope:

\- Attendance management

\- Event management

\- Complaint management

\- Authentication

\- Role-based access control (Authorization)

\- Reports

\- Audit logging

##### Out of Scope:

\- Online fee payment

\- Academic examination management

\- Hostel room allocation

\- Food ordering

\- Library management

\- Direct integration with college ERP

#### Assumptions:

1\. Users have valid institutional email IDs.

2\. Students and staff are already registered in the system.

3\. Staff members are associated with the subjects/classes they teach.

4\. Club Heads are associated with their respective clubs.

5\. Users have internet access to access the application.

#### Constraints:

1\. Application is initially designed for one college.

2\. Only authorized institutional users can access protected features.

3\. Attendance data must not be editable by students.

4\. Uploaded complaint images must satisfy predefined size/type restrictions.

5\. The initial system uses a centralized backend and relational database.

#### Stakeholders:

1\. College Management

2\. Students

3\. Teaching Staff

4\. Club Heads

5\. System Administrators

6\. Development / Maintenance Team

#### Users:

1\.Students
2\. Staff / Faculty
3\. Club Heads
4\. Admin

### 1\.Reqirement Phase:

#### Aim: To define the functional and non-functional requirements of the application, along with the stakeholders and users of the application incorporating security practices in each requirement.

##### Estimated user base:

\- Students: \~2,000

\- Staff / Faculty: \~100

\- Club Heads: \~20

\- Admins: \~5

##### Expected concurrent active users during normal operation:

\~500–1000 users

##### Expected peak concurrent users:

\~300 users

##### The system is expected to handle concentrated activity during:

\- Attendance marking/viewing after classes

\- Popular event registration periods

\- Important college announcements or events

##### The initial system should be designed to support:

\- Up to 2,500 registered users

\- Up to 300 concurrent active users

\- At least 60 requests/minute during expected peak activity

\- Short-term traffic spikes above the normal expected load

#### Module 1 - Attendance Marking System:

##### Functional Requirements:

Staff:

Staff can mark attendance for a particular class, section, subject, date and period.
Staff can update attendance for a previously marked class.
Staff can view attendance for the classes and subjects handled by them.
Staff can export attendance reports.
Staff should be able to identify whether attendance for a particular class and period has already been marked.

Students:

Students can view their attendance for the subjects they are enrolled in.
Students can view their attendance percentage.
Students cannot access attendance records belonging to other students.
Students cannot modify attendance records.

##### Non-Functional Requirements:

Separate display for students and staff
Attendance viewing should normally respond within 500 ms under normal load.
Attendance marking operations should happen withing 2 seconds.

##### Expected workload:

Suppose there are 30 submissions per hour: 0.5 requests/min.
Suppose 300 students check attendance during a 10-minute period: Approx. 30 requests/min.

##### Design Target: 30–60 attendance requests/minute.

#### Module 2 - Event Management System:

##### Functional Requirements:

Admin:

Admin can view current, upcoming and past events.
Admin provide access to club heads to post events.
Admin can view event participation statistics.
Admin can supervise events posted by clubs.
Admin can manage club/event access.
Admin can view all events.

Club Heads:

Club Heads can create events belonging to their club.
Club Heads can update their club's events.
Club Heads can provide event details and registration links.
Club Heads cannot modify events belonging to other clubs.

Students:

Students can view events from all clubs.
Students can view event details.
Students can register for events.
Students cannot modify events.
The system should prevent duplicate registration for the same event.

##### Non-Functional Requirements:

Event listing should normally load within 500 ms under normal load.
Event registration should normally complete within 2 seconds.
Events to be separated by clubs (sub cards within club cards).

##### Expected Workload:

Suppose 500 students use the app to view events.
500 requests / 30 minutes = Approx. 17 requests/min.

##### Design Target: 20–50 requests/minute during normal peaks.

#### Module 3 - Complaint Management System:

##### Functional Requirements:

Admin:

Admin can view complaints submitted by users.
Admin can accept or reject complaints.
Admin must provide a reason when rejecting a complaint.
Admin can update the status of accepted complaints.
Admin can mark complaints as resolved.
Admin can view feedback associated with resolved/rejected complaints.

Students/staff:

Users can raise a complaint.
Users can provide a description of the issue.
Users can optionally attach an image.
Users can view the status of their complaints.
Users can view the response/reason for rejected complaints.
Users can provide feedback after a complaint is resolved or rejected.

##### Non-Functional Requirements:

Complaint raised should be seen (Accepted or rejected) within 2 hours by the admin.
Complaint should be resolved within 2 days depending on the severity of the complaint.
Detailed description for rejected complaints.
Complaint submission should normally complete within 2 seconds, excluding image upload time.
Complaint status should normally load within 500 ms.

#### Data Requirements:

##### Users Data:

- User ID
- Name
- Institutional email
- Phone Number
- Role
- Department

##### Attendance Session Data:

- Class
- Section
- Subject
- Hour
- Date
- Presentees / Absentees
- Faculty
- Timestamp

##### Student Attendance Data:

- Student ID
- Session

##### Event Data:

- Event ID
- Event Name
- Club
- Description
- Date
- Time
- Venue
- Event Image
- Registration Link
- Event Creator
- Event Status
- Participations / Registrations

##### Complaint Data:

- Complaint ID
- Complaint Title
- Description
- User ID
- Submission Date
- Submission Time
- Image
- Complaint Status
- Admin Response
- Resolution Date/Time
- Resolution details
- User Feedback

##### Reports:

Attendance:
Student-wise attendance
Subject-wise attendance
class/section attendance

#### Rules:

##### Attendance Rules:

1\. Attendance shall be recorded for a specific class, section, subject, date and period.

2\. Only staff assigned to the respective class and subject can mark attendance for that session.

3\. A student can have only one attendance status for a particular attendance session.

4\. Students can view only their own attendance.

5\. Students cannot create or modify attendance records.

6\. Attendance can be updated only by authorized staff.

7\. An attendance session should not be created as a duplicate for the same class, subject, date and period.

8\. Every attendance modification should record who performed the modification and when.

##### Event Rules:

1\. Every event shall belong to a specific club.

2\. Club Heads are given access by the admin.

3\. A Club Head can create and modify events only for their assigned club.

4\. Students can view events from all clubs.

5\. Students cannot modify event information.

6\. A user cannot register more than once for the same event.

7\. Registration shall not be allowed after an event's registration period has ended.

8\. An event cannot be modified by a Club Head belonging to another club.

##### Complaint Rules:

1\. A complaint must have a submitter.

2\. A complaint must have a description.

3\. Image attachment is optional.

4\. Only authorized Admins can change the processing status of a complaint.

5\. A complaint can be rejected only with a rejection reason.

6\. A complaint can be marked as resolved only after it has been accepted.

7\. Users can view only their own complaints.

8\. Users can provide feedback only after the complaint has been resolved or rejected.

### System Design:

#### System Context:

![1791465202772](image/CampusOne/1791465202772.png)

#### High Level Architecture:

![1791466566130](image/CampusOne/1791466566130.png)

#### Component / Module Design:

HLD
│
├── Frontend
│ │
│ ├── Student Interface
│ ├── Staff Interface
│ ├── Club Head Interface
│ └── Admin Interface
│
└── Backend
│
├── Authentication
├── Attendance
├── Events
├── Complaints

#### Frontend Component Design:

Student Interface Component Design:

![1791471172333](image/CampusOne/1791471172333.png)

Staff Interface Component Design:

![1791471059437](image/CampusOne/1791471059437.png)

Club Head Interface Component Design:

![1791471286393](image/CampusOne/1791471286393.png)

Admin Interface Component Design:


#### Backend Component Design:

Authentication and Authorization component Design:

![1791472856117](image/CampusOne/1791472856117.png)


Attendance Backend Component Design:

![1791473209774](image/CampusOne/1791473209774.png)

Event Management Backend Component Design:

![1791473686310](image/CampusOne/1791473686310.png)

Complaint Management Backend Component Design:

![1791474245217](image/CampusOne/1791474245217.png)
