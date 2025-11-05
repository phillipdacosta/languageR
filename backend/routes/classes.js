const express = require('express');
const router = express.Router();
const ClassModel = require('../models/Class');
const User = require('../models/User');
const { verifyToken } = require('../middleware/videoUploadMiddleware');

function addMinutes(date, minutes) {
  const d = new Date(date);
  d.setMinutes(d.getMinutes() + minutes);
  return d;
}

function nextOccurrence(start, i, type) {
  const d = new Date(start);
  if (type === 'daily') d.setDate(d.getDate() + i);
  else if (type === 'weekly') d.setDate(d.getDate() + 7 * i);
  else if (type === 'monthly') d.setMonth(d.getMonth() + i);
  return d;
}

// POST /api/classes - create class (supports simple recurrence by count)
router.post('/', verifyToken, async (req, res) => {
  try {
    const { name, capacity, isPublic, startTime, endTime, recurrence } = req.body;

    if (!name || !startTime || !endTime) {
      return res.status(400).json({ success: false, message: 'name, startTime and endTime are required' });
    }

    const tutor = await User.findOne({ auth0Id: req.user.sub });
    if (!tutor) return res.status(404).json({ success: false, message: 'Tutor not found' });
    if (tutor.userType !== 'tutor') return res.status(403).json({ success: false, message: 'Only tutors can create classes' });

    const recType = recurrence?.type || 'none';
    const count = Math.max(1, Math.min(100, parseInt(recurrence?.count || 1)));

    const created = [];
    for (let i = 0; i < count; i++) {
      const s = i === 0 || recType === 'none' ? new Date(startTime) : nextOccurrence(startTime, i, recType);
      const durationMin = Math.max(15, Math.round((new Date(endTime) - new Date(startTime)) / 60000));
      const e = addMinutes(s, durationMin);

      const cls = new ClassModel({
        tutorId: tutor._id,
        name,
        capacity: capacity || 1,
        isPublic: !!isPublic,
        startTime: s,
        endTime: e,
        recurrence: { type: recType, count }
      });
      await cls.save();
      created.push(cls);
    }

    // Update tutor availability by appending blocks that represent the class time as unavailable
    const availability = Array.isArray(tutor.availability) ? tutor.availability.slice() : [];
    created.forEach(c => {
      const d = new Date(c.startTime);
      const day = d.getDay();
      const pad = (n) => n.toString().padStart(2, '0');
      const timeStr = `${pad(d.getHours())}:${pad(d.getMinutes())}`;
      const de = new Date(c.endTime);
      const timeStrEnd = `${pad(de.getHours())}:${pad(de.getMinutes())}`;
      availability.push({
        id: `${c._id}`,
        absoluteStart: c.startTime,
        absoluteEnd: c.endTime,
        day,
        startTime: timeStr,
        endTime: timeStrEnd,
        type: 'class',
        title: `Class: ${c.name}`,
        color: '#8b5cf6'
      });
    });
    tutor.availability = availability;
    await tutor.save();

    res.json({ success: true, classes: created });
  } catch (error) {
    console.error('Error creating class:', error);
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
});

module.exports = router;


