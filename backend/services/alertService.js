const Alert = require('../models/Alert');

class AlertService {
  /**
   * Create an alert for payment issues
   */
  async createAlert({ type, severity = 'MEDIUM', title, description, data = {}, paymentId, lessonId, userId, stripePaymentIntentId, stripePayoutId, paypalBatchId }) {
    try {
      // Check if similar alert already exists (avoid duplicates)
      const existingAlert = await Alert.findOne({
        type,
        status: 'active',
        paymentId: paymentId || undefined,
        lessonId: lessonId || undefined,
        createdAt: { $gt: new Date(Date.now() - 24 * 60 * 60 * 1000) } // Within last 24 hours
      });

      if (existingAlert) {
        console.log(`⚠️  [ALERT] Duplicate alert detected for ${type}, skipping`);
        return existingAlert;
      }

      const alert = await Alert.create({
        type,
        severity,
        title,
        description,
        data,
        paymentId,
        lessonId,
        userId,
        stripePaymentIntentId,
        stripePayoutId,
        paypalBatchId,
        status: 'active'
      });

      console.log(`🚨 [ALERT] Created ${severity} alert: ${type} (${alert._id})`);

      // Send notifications based on severity
      await this.sendNotifications(alert);

      return alert;
    } catch (error) {
      console.error('❌ [ALERT] Failed to create alert:', error);
      throw error;
    }
  }

  /**
   * Send notifications for an alert
   */
  async sendNotifications(alert) {
    const notifications = [];

    // Always send websocket for real-time admin dashboard
    try {
      const serverModule = require('../server');
      if (serverModule && typeof serverModule.getIO === 'function') {
        const io = serverModule.getIO();
        if (io) {
          io.emit('admin_alert', {
            alertId: alert._id.toString(),
            type: alert.type,
            severity: alert.severity,
            title: alert.title,
            description: alert.description,
            data: alert.data,
            createdAt: alert.createdAt
          });
          
          notifications.push({
            channel: 'websocket',
            sentAt: new Date(),
            recipient: 'admin'
          });
          
          console.log(`📡 [ALERT] Sent websocket notification for ${alert.type}`);
        }
      }
    } catch (error) {
      console.error('❌ [ALERT] Failed to send websocket:', error.message);
    }

    // Send email for HIGH/CRITICAL alerts
    if (['HIGH', 'CRITICAL'].includes(alert.severity)) {
      try {
        const nodemailer = require('nodemailer');
        
        // Only send email if configured
        if (process.env.SMTP_USER && process.env.SMTP_PASSWORD) {
          const transporter = nodemailer.createTransport({
            service: 'gmail',
            auth: {
              user: process.env.SMTP_USER,
              pass: process.env.SMTP_PASSWORD
            }
          });

          await transporter.sendMail({
            from: process.env.SMTP_USER,
            to: process.env.ADMIN_EMAIL || process.env.SMTP_USER,
            subject: `🚨 [${alert.severity}] Payment Alert: ${alert.type}`,
            html: `
              <h2>Payment System Alert</h2>
              <p><strong>Type:</strong> ${alert.type}</p>
              <p><strong>Severity:</strong> ${alert.severity}</p>
              <p><strong>Title:</strong> ${alert.title}</p>
              <p><strong>Description:</strong> ${alert.description || 'N/A'}</p>
              <p><strong>Time:</strong> ${alert.createdAt}</p>
              <hr>
              <h3>Details:</h3>
              <pre>${JSON.stringify(alert.data, null, 2)}</pre>
              <hr>
              <p><a href="${process.env.FRONTEND_URL || 'http://localhost:8100'}/admin/payment-review">View in Admin Dashboard</a></p>
            `
          });

          notifications.push({
            channel: 'email',
            sentAt: new Date(),
            recipient: process.env.ADMIN_EMAIL || process.env.SMTP_USER
          });

          console.log(`📧 [ALERT] Sent email notification for ${alert.type}`);
        } else {
          console.log(`⚠️  [ALERT] Email not configured, skipping email for ${alert.type}`);
        }
      } catch (error) {
        console.error('❌ [ALERT] Failed to send email:', error.message);
      }
    }

    // Update alert with notification records
    if (notifications.length > 0) {
      alert.notificationsSent = notifications;
      await alert.save();
    }
  }

  /**
   * Get active alerts
   */
  async getActiveAlerts({ severity, type, limit = 100 } = {}) {
    const query = { status: { $in: ['active', 'investigating'] } };
    
    if (severity) query.severity = severity;
    if (type) query.type = type;

    return await Alert.find(query)
      .populate('paymentId lessonId userId')
      .sort({ severity: -1, createdAt: -1 })
      .limit(limit);
  }

  /**
   * Resolve an alert
   */
  async resolveAlert(alertId, { resolvedBy, resolutionNotes }) {
    const alert = await Alert.findById(alertId);
    
    if (!alert) {
      throw new Error('Alert not found');
    }

    alert.status = 'resolved';
    alert.resolvedAt = new Date();
    alert.resolvedBy = resolvedBy;
    alert.resolutionNotes = resolutionNotes;

    await alert.save();

    console.log(`✅ [ALERT] Resolved alert ${alertId}: ${alert.type}`);

    // Notify admin via websocket (if available)
    try {
      const serverModule = require('../server');
      if (serverModule && typeof serverModule.getIO === 'function') {
        const io = serverModule.getIO();
        if (io) {
          io.emit('admin_alert_resolved', {
            alertId: alertId.toString(),
            resolvedAt: alert.resolvedAt
          });
          console.log(`📡 [ALERT] Sent websocket notification for alert resolution`);
        }
      }
    } catch (error) {
      console.log(`❌ [ALERT] Failed to send websocket:`, error.message);
      // Don't throw - resolution still succeeded
    }

    return alert;
  }

  /**
   * Get alert statistics
   */
  async getAlertStats() {
    const stats = await Alert.aggregate([
      {
        $group: {
          _id: { status: '$status', severity: '$severity' },
          count: { $sum: 1 }
        }
      }
    ]);

    const result = {
      active: { CRITICAL: 0, HIGH: 0, MEDIUM: 0, LOW: 0 },
      investigating: { CRITICAL: 0, HIGH: 0, MEDIUM: 0, LOW: 0 },
      resolved: { total: 0 }
    };

    stats.forEach(stat => {
      if (stat._id.status === 'resolved') {
        result.resolved.total += stat.count;
      } else if (result[stat._id.status]) {
        result[stat._id.status][stat._id.severity] = stat.count;
      }
    });

    return result;
  }
}

module.exports = new AlertService();

