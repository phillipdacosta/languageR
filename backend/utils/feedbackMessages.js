/**
 * Dynamic, engaging messages for tutor feedback notifications
 * Rotates through different messages to keep things fresh and not boring
 */

const FEEDBACK_MESSAGES = [
  {
    title: "Feedback Time! ✍️",
    message: "Share your thoughts while the lesson is still fresh in your mind!"
  },
  {
    title: "Quick Feedback Needed 📝",
    message: "Help your student grow - jot down your insights while they're top of mind!"
  },
  {
    title: "Your Feedback Matters 🌟",
    message: "Capture those key moments before they fade - your student is counting on it!"
  },
  {
    title: "Don't Let It Slip Away ⏰",
    message: "The best feedback comes when the lesson is still warm. Take a moment now!"
  },
  {
    title: "Strike While the Iron's Hot 🔥",
    message: "Your observations are most valuable right now. Share what you noticed!"
  },
  {
    title: "Fresh Perspective Alert 👀",
    message: "Document those 'aha moments' and areas to work on before they slip your mind!"
  },
  {
    title: "Lesson Recap Needed 📚",
    message: "While it's all fresh, help your student understand what to focus on next!"
  },
  {
    title: "Time to Reflect 💭",
    message: "Your insights right now are gold. Take 2 minutes to share your thoughts!"
  },
  {
    title: "Feedback Request 🎯",
    message: "Catch those teaching moments while they're vivid - your student will thank you!"
  },
  {
    title: "Your Turn to Teach 📖",
    message: "Share what worked and what needs practice while the lesson is still clear!"
  },
  {
    title: "Make It Count 💪",
    message: "The best time to give feedback is now, while everything is crystal clear!"
  },
  {
    title: "Quick Check-In Needed ✅",
    message: "5 minutes now saves hours later. Document what you noticed while it's fresh!"
  }
];

/**
 * Get a random feedback message
 * Uses a pseudo-random selection based on timestamp to vary messages
 * @param {String} seedId - Optional seed ID (like lessonId) for consistent selection
 * @returns {Object} { title, message }
 */
function getRandomFeedbackMessage(seedId = null) {
  let index;
  
  if (seedId) {
    // Use seedId to generate consistent but varied index
    const hash = seedId.split('').reduce((acc, char) => acc + char.charCodeAt(0), 0);
    index = hash % FEEDBACK_MESSAGES.length;
  } else {
    // Use timestamp for true randomness
    index = Math.floor(Date.now() / 1000) % FEEDBACK_MESSAGES.length;
  }
  
  return FEEDBACK_MESSAGES[index];
}

/**
 * Get feedback reminder message (more urgent tone)
 * Used for reminder notifications after initial notification
 */
const REMINDER_MESSAGES = [
  {
    title: "Friendly Reminder 🔔",
    message: "Your student is waiting for feedback on their recent lesson. Can you spare a few minutes?"
  },
  {
    title: "Still Pending: Feedback Needed 📝",
    message: "Quick reminder - your feedback helps your student improve. It only takes a moment!"
  },
  {
    title: "Don't Forget! ⏰",
    message: "Your insights are valuable! Please share feedback from your recent lesson."
  },
  {
    title: "Feedback Follow-Up 🎯",
    message: "Hey! Just checking in - your student would love to hear your thoughts on the lesson."
  },
  {
    title: "Action Needed: Lesson Feedback 📚",
    message: "Your feedback is an essential part of the learning journey. Please take a moment to share!"
  }
];

/**
 * Get a reminder message
 * @param {Number} reminderCount - How many reminders have been sent
 * @returns {Object} { title, message }
 */
function getReminderMessage(reminderCount = 0) {
  const index = reminderCount % REMINDER_MESSAGES.length;
  return REMINDER_MESSAGES[index];
}

module.exports = {
  getRandomFeedbackMessage,
  getReminderMessage
};

