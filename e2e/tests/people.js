// The fixed people and content the test database starts with (global-setup.js).
export const PROFESSOR = { email: 'prof@test.local', password: 'profpass1', name: 'Professor Test' };

export const STUDENTS = {
  alice:  { label: 'Student, Alice',  name: 'Alice Student',  password: 'alicepass1' },
  bob:    { label: 'Student, Bob',    name: 'Bob Student',    password: 'bobpass1' },
  newbie: { label: 'Student, Newbie', name: 'Newbie Student', password: null },  // hasn't signed in yet
  casey:  { label: 'Student, Casey',  name: 'Casey Student',  password: 'caseypass1' },  // used by summary tests
  dana:   { label: 'Student, Dana',   name: 'Dana Student',   password: 'danapass1' },   // Questions card action tests
  erin:   { label: 'Student, Erin',   name: 'Erin Student',   password: 'erinpass1' },   // corner assistant tests
};

export const CLASS = { title: 'TEST 101', section: 'E2E', label: 'TEST 101 · E2E' };
export const POST  = { title: 'Week 1 discussion', content: 'Share one takeaway from the reading.' };
export const BOB_COMMENT = 'What did everyone think of the reading?';
