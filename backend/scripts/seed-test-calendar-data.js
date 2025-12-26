/**
 * Seed test calendar data for travelbuggler@gmail.com
 * Creates lessons and classes spanning 6 months (3 months past, 3 months future)
 * to test lazy loading functionality
 */

require('dotenv').config({ path: require('path').join(__dirname, '..', 'config.env') });
const mongoose = require('mongoose');
const User = require('../models/User');
const Lesson = require('../models/Lesson');
const ClassModel = require('../models/Class');

const MONGODB_URI = process.env.MONGODB_URI;
const TEST_TUTOR_EMAIL = 'travelbuggler@gmail.com';

// Helper to add days
function addDays(date, days) {
  const result = new Date(date);
  result.setDate(result.getDate() + days);
  return result;
}

// Helper to add minutes
function addMinutes(date, minutes) {
  const result = new Date(date);
  result.setMinutes(result.getMinutes() + minutes);
  return result;
}

// Helper to set time on a date
function setTime(date, hours, minutes) {
  const result = new Date(date);
  result.setHours(hours, minutes, 0, 0);
  return result;
}

// Common lesson times (various throughout the day)
const LESSON_TIMES = [
  { hour: 9, minute: 0, duration: 25 },
  { hour: 10, minute: 30, duration: 50 },
  { hour: 13, minute: 0, duration: 25 },
  { hour: 14, minute: 30, duration: 50 },
  { hour: 16, minute: 0, duration: 25 },
  { hour: 18, minute: 0, duration: 50 },
  { hour: 19, minute: 30, duration: 25 },
];

const SUBJECTS = ['Spanish', 'French', 'German', 'Italian', 'Portuguese'];
const CLASS_NAMES = [
  'Beginner Spanish Conversation',
  'Advanced French Grammar',
  'German for Travel',
  'Italian Culture & Language',
  'Business Portuguese',
];

async function seedCalendarData() {
  try {
    console.log('🔌 Connecting to MongoDB...');
    await mongoose.connect(MONGODB_URI);
    console.log('✅ Connected to MongoDB');

    // Find tutor
    const tutor = await User.findOne({ email: TEST_TUTOR_EMAIL });
    if (!tutor) {
      console.error(`❌ Tutor not found: ${TEST_TUTOR_EMAIL}`);
      process.exit(1);
    }
    console.log(`✅ Found tutor: ${tutor.name} (${tutor._id})`);

    // Find or create students
    let students = await User.find({ 
      userType: 'student',
      email: { $ne: TEST_TUTOR_EMAIL }
    }).limit(5);
    
    if (students.length === 0) {
      console.log('📝 No students found, creating test students...');
      const testStudents = [
        {
          email: 'student1@test.com',
          name: 'Alice Johnson',
          firstName: 'Alice',
          lastName: 'Johnson',
          userType: 'student',
          auth0Id: `student1_${Date.now()}`,
          picture: 'https://via.placeholder.com/150',
        },
        {
          email: 'student2@test.com',
          name: 'Bob Smith',
          firstName: 'Bob',
          lastName: 'Smith',
          userType: 'student',
          auth0Id: `student2_${Date.now()}`,
          picture: 'https://via.placeholder.com/150',
        },
        {
          email: 'student3@test.com',
          name: 'Carol White',
          firstName: 'Carol',
          lastName: 'White',
          userType: 'student',
          auth0Id: `student3_${Date.now()}`,
          picture: 'https://via.placeholder.com/150',
        },
        {
          email: 'student4@test.com',
          name: 'David Brown',
          firstName: 'David',
          lastName: 'Brown',
          userType: 'student',
          auth0Id: `student4_${Date.now()}`,
          picture: 'https://via.placeholder.com/150',
        },
        {
          email: 'student5@test.com',
          name: 'Emma Davis',
          firstName: 'Emma',
          lastName: 'Davis',
          userType: 'student',
          auth0Id: `student5_${Date.now()}`,
          picture: 'https://via.placeholder.com/150',
        },
      ];
      
      students = await User.insertMany(testStudents);
      console.log(`✅ Created ${students.length} test students`);
    }
    console.log(`✅ Found/created ${students.length} students`);

    // Calculate date range: 3 months past to 3 months future
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const startDate = addDays(today, -90); // 3 months ago
    const endDate = addDays(today, 90);     // 3 months from now

    console.log(`📅 Seeding data from ${startDate.toDateString()} to ${endDate.toDateString()}`);

    // Delete existing test data for this tutor
    console.log('🗑️  Deleting existing lessons and classes for this tutor...');
    const deletedLessons = await Lesson.deleteMany({ tutorId: tutor._id });
    const deletedClasses = await ClassModel.deleteMany({ tutorId: tutor._id });
    console.log(`   Deleted ${deletedLessons.deletedCount} lessons and ${deletedClasses.deletedCount} classes`);

    // Create lessons
    const lessons = [];
    let lessonsCreated = 0;
    let classesCreated = 0;

    // Create 2-3 lessons per week for the entire date range
    for (let date = new Date(startDate); date <= endDate; date = addDays(date, 1)) {
      const dayOfWeek = date.getDay();
      
      // Skip Sundays, and only create lessons on some days
      if (dayOfWeek === 0) continue;
      
      // Create lessons on Monday, Wednesday, Friday (60% chance)
      // And occasionally on other weekdays (30% chance)
      const shouldCreateLesson = 
        ([1, 3, 5].includes(dayOfWeek) && Math.random() < 0.6) ||
        ([2, 4, 6].includes(dayOfWeek) && Math.random() < 0.3);
      
      if (!shouldCreateLesson) continue;

      // Create 1-2 lessons on this day
      const lessonsToday = Math.random() < 0.7 ? 1 : 2;
      
      for (let i = 0; i < lessonsToday; i++) {
        const timeSlot = LESSON_TIMES[Math.floor(Math.random() * LESSON_TIMES.length)];
        const student = students[Math.floor(Math.random() * students.length)];
        const subject = SUBJECTS[Math.floor(Math.random() * SUBJECTS.length)];
        
        const startTime = setTime(date, timeSlot.hour, timeSlot.minute);
        const endTime = addMinutes(startTime, timeSlot.duration);
        
        // Determine status based on date
        const isPast = endTime < today;
        const isFuture = startTime > today;
        let status = 'scheduled';
        
        if (isPast) {
          // 90% completed, 10% cancelled for past lessons
          status = Math.random() < 0.9 ? 'completed' : 'cancelled';
        } else if (isFuture) {
          // 95% scheduled, 5% cancelled for future lessons
          status = Math.random() < 0.95 ? 'scheduled' : 'cancelled';
        }
        
        const isTrialLesson = Math.random() < 0.1; // 10% trial lessons
        
        lessons.push({
          tutorId: tutor._id,
          studentId: student._id,
          startTime,
          endTime,
          subject,
          status,
          isTrialLesson,
          price: isTrialLesson ? 0 : 25, // Trial lessons are free, regular lessons are $25
          channelName: `lesson_${tutor._id}_${student._id}_${Date.now()}_${Math.random().toString(36).substring(7)}`,
          meetingUrl: `https://meet.example.com/${Math.random().toString(36).substring(7)}`,
          createdAt: addDays(startTime, -7), // Created a week before
        });
        
        lessonsCreated++;
      }
    }

    // Bulk insert lessons
    if (lessons.length > 0) {
      console.log(`📚 Creating ${lessons.length} lessons...`);
      await Lesson.insertMany(lessons);
      console.log(`✅ Created ${lessonsCreated} lessons`);
    }

    // Create classes (1-2 per week)
    const classes = [];
    
    for (let date = new Date(startDate); date <= endDate; date = addDays(date, 7)) {
      const shouldCreateClass = Math.random() < 0.7; // 70% chance per week
      if (!shouldCreateClass) continue;
      
      const timeSlot = LESSON_TIMES[Math.floor(Math.random() * LESSON_TIMES.length)];
      const className = CLASS_NAMES[Math.floor(Math.random() * CLASS_NAMES.length)];
      const subject = SUBJECTS[Math.floor(Math.random() * SUBJECTS.length)];
      
      const startTime = setTime(date, timeSlot.hour, timeSlot.minute);
      const endTime = addMinutes(startTime, timeSlot.duration);
      
      // Determine status based on date
      const isPast = endTime < today;
      const isFuture = startTime > today;
      let status = 'scheduled';
      
      if (isPast) {
        // 85% scheduled, 15% cancelled for past classes
        status = Math.random() < 0.85 ? 'scheduled' : 'cancelled';
      } else if (isFuture) {
        // 90% scheduled, 10% cancelled for future classes
        status = Math.random() < 0.9 ? 'scheduled' : 'cancelled';
      }
      
      // Random 2-4 students confirmed
      const numConfirmed = Math.floor(Math.random() * 3) + 2;
      const confirmedStudents = students
        .slice(0, numConfirmed)
        .map(s => s._id);
      
      const capacity = Math.floor(Math.random() * 3) + 5; // 5-7 capacity
      
      classes.push({
        tutorId: tutor._id,
        name: className,
        description: `A comprehensive ${className} class`,
        subject,
        level: ['any', 'beginner', 'intermediate', 'advanced'][Math.floor(Math.random() * 4)],
        startTime,
        endTime,
        duration: timeSlot.duration,
        capacity,
        confirmedStudents,
        invitedStudents: [],
        status,
        classType: 'single',
        groupDiscount: 20,
        basePrice: 25,
        price: 25,
        createdAt: addDays(startTime, -14), // Created 2 weeks before
      });
      
      classesCreated++;
    }

    // Bulk insert classes
    if (classes.length > 0) {
      console.log(`📚 Creating ${classes.length} classes...`);
      await ClassModel.insertMany(classes);
      console.log(`✅ Created ${classesCreated} classes`);
    }

    console.log('\n✨ Seeding complete!');
    console.log(`📊 Summary:`);
    console.log(`   - Tutor: ${tutor.name} (${tutor.email})`);
    console.log(`   - Date range: ${startDate.toDateString()} to ${endDate.toDateString()}`);
    console.log(`   - Lessons created: ${lessonsCreated}`);
    console.log(`   - Classes created: ${classesCreated}`);
    console.log(`   - Total events: ${lessonsCreated + classesCreated}`);

    await mongoose.connection.close();
    console.log('🔌 Disconnected from MongoDB');
    
  } catch (error) {
    console.error('❌ Error seeding data:', error);
    process.exit(1);
  }
}

// Run the seeding script
seedCalendarData();

