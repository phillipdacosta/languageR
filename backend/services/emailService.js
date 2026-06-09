const sgMail = require('@sendgrid/mail');

class EmailService {
  constructor() {
    this.apiKey = process.env.SENDGRID_API_KEY || '';
    this.fromEmail = process.env.SENDGRID_FROM_EMAIL || '';
    this.fromName = process.env.SENDGRID_FROM_NAME || 'Barnabi';
    this.replyToEmail = process.env.SENDGRID_REPLY_TO_EMAIL || process.env.SUPPORT_EMAIL || '';
    this.lessonBookedTemplateId = process.env.SENDGRID_LESSON_BOOKED_TEMPLATE_ID || '';
    this.lessonBookedTutorTemplateId = process.env.SENDGRID_LESSON_BOOKED_TUTOR_TEMPLATE_ID
      || process.env.SENDGRID_LESSON_BOOKED_TEMPLATE_ID
      || '';

    if (this.apiKey) {
      sgMail.setApiKey(this.apiKey);
    }
  }

  isConfigured() {
    return Boolean(this.apiKey && this.fromEmail && this.lessonBookedTemplateId);
  }

  isTutorConfigured() {
    return Boolean(this.apiKey && this.fromEmail && this.lessonBookedTutorTemplateId);
  }

  getConfigStatus() {
    return {
      configured: this.isConfigured(),
      hasApiKey: Boolean(this.apiKey),
      hasFromEmail: Boolean(this.fromEmail),
      hasTemplateId: Boolean(this.lessonBookedTemplateId),
      hasTutorTemplateId: Boolean(this.lessonBookedTutorTemplateId),
      fromEmail: this.fromEmail || null,
      templateId: this.lessonBookedTemplateId || null,
      tutorTemplateId: this.lessonBookedTutorTemplateId || null
    };
  }

  /**
   * Send a SendGrid dynamic template email.
   * Subject must live in dynamicTemplateData.subject; the template Subject field
   * should be set to {{subject}} (or {{{subject}}}) in SendGrid — top-level msg.subject
   * is ignored and can cause blank subjects with dynamic templates.
   * @param {Object} opts
   * @param {string} opts.to
   * @param {string} opts.templateId
   * @param {Object} opts.dynamicTemplateData
   * @param {string} [opts.subject] Merged into dynamicTemplateData.subject
   */
  async sendTemplateEmail({ to, templateId, dynamicTemplateData, subject }) {
    if (!this.apiKey) {
      throw new Error('SendGrid API key is not configured');
    }
    if (!this.fromEmail) {
      throw new Error('SENDGRID_FROM_EMAIL is not configured');
    }
    if (!to) {
      throw new Error('Recipient email is required');
    }

    const resolvedSubject = String(subject || dynamicTemplateData?.subject || '').trim();
    if (!resolvedSubject) {
      console.warn('📧 [EMAIL] SendGrid dynamicTemplateData.subject is empty — set template Subject to {{subject}} in SendGrid');
    }

    const msg = {
      to,
      from: {
        email: this.fromEmail,
        name: this.fromName
      },
      templateId: templateId || this.lessonBookedTemplateId,
      dynamicTemplateData: {
        ...dynamicTemplateData,
        subject: resolvedSubject
      }
    };

    if (this.replyToEmail) {
      msg.replyTo = {
        email: this.replyToEmail,
        name: this.fromName
      };
    }

    try {
      await sgMail.send(msg);
    } catch (error) {
      const detail = error?.response?.body
        ? JSON.stringify(error.response.body)
        : error.message;
      console.error('📧 [EMAIL] SendGrid send failed:', detail);
      throw error;
    }
  }

  async sendLessonBookedEmail({ to, dynamicTemplateData, subject }) {
    if (!this.isConfigured()) {
      console.log('📧 [EMAIL] SendGrid lesson booking email skipped — not configured');
      return false;
    }

    await this.sendTemplateEmail({
      to,
      templateId: this.lessonBookedTemplateId,
      dynamicTemplateData,
      subject
    });

    return true;
  }

  async sendLessonBookedTutorEmail({ to, dynamicTemplateData, subject }) {
    if (!this.isTutorConfigured()) {
      console.log('📧 [EMAIL] SendGrid tutor lesson booking email skipped — not configured');
      return false;
    }

    await this.sendTemplateEmail({
      to,
      templateId: this.lessonBookedTutorTemplateId,
      dynamicTemplateData,
      subject
    });

    return true;
  }
}

module.exports = new EmailService();
