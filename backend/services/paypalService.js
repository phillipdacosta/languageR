/**
 * PayPal Payouts Service
 * Handles sending payouts to tutors via PayPal
 */

const paypal = require('@paypal/payouts-sdk');

class PayPalService {
  constructor() {
    this.client = null;
    this.initializeClient();
  }

  /**
   * Initialize PayPal client with credentials from environment
   */
  initializeClient() {
    const clientId = process.env.PAYPAL_CLIENT_ID;
    const clientSecret = process.env.PAYPAL_SECRET;
    const mode = process.env.PAYPAL_MODE || 'sandbox'; // 'sandbox' or 'live'

    if (!clientId || !clientSecret) {
      console.warn('⚠️  PayPal credentials not configured. PayPal payouts will be disabled.');
      return;
    }

    // Choose environment based on mode
    let environment;
    if (mode === 'live') {
      environment = new paypal.core.LiveEnvironment(clientId, clientSecret);
    } else {
      environment = new paypal.core.SandboxEnvironment(clientId, clientSecret);
    }

    this.client = new paypal.core.PayPalHttpClient(environment);
    console.log(`✅ PayPal client initialized in ${mode} mode`);
  }

  /**
   * Check if PayPal is configured and available
   */
  isAvailable() {
    return this.client !== null;
  }

  /**
   * Send a payout to a tutor
   * @param {Object} params
   * @param {string} params.tutorId - MongoDB tutor ID
   * @param {string} params.paypalEmail - Tutor's PayPal email
   * @param {number} params.amount - Amount to send (in dollars)
   * @param {string} params.lessonId - Associated lesson ID (optional)
   * @param {string} params.note - Note for the payout (optional)
   * @returns {Promise<Object>} PayPal payout response
   */
  async sendPayout({ tutorId, paypalEmail, amount, lessonId, note }) {
    if (!this.isAvailable()) {
      throw new Error('PayPal service is not configured');
    }

    if (!paypalEmail || !paypalEmail.includes('@')) {
      throw new Error('Valid PayPal email is required');
    }

    if (!amount || amount <= 0) {
      throw new Error('Valid amount is required');
    }

    try {
      // Create payout batch
      const requestBody = {
        sender_batch_header: {
          sender_batch_id: `BATCH_${tutorId}_${Date.now()}`, // Unique batch ID
          email_subject: 'You have a payout from LanguageR!',
          email_message: note || 'Thank you for teaching on LanguageR. Here is your payment.'
        },
        items: [
          {
            recipient_type: 'EMAIL',
            amount: {
              value: amount.toFixed(2),
              currency: 'USD'
            },
            receiver: paypalEmail,
            note: note || `Payout from LanguageR${lessonId ? ` for lesson ${lessonId}` : ''}`,
            sender_item_id: lessonId || `PAYOUT_${tutorId}_${Date.now()}` // Unique item ID
          }
        ]
      };

      console.log(`💸 [PAYPAL] Sending payout: $${amount} to ${paypalEmail}`);

      const request = new paypal.payouts.PayoutsPostRequest();
      request.requestBody(requestBody);

      const response = await this.client.execute(request);
      
      console.log(`✅ [PAYPAL] Payout sent successfully`);
      console.log(`   Batch ID: ${response.result.batch_header.payout_batch_id}`);
      console.log(`   Status: ${response.result.batch_header.batch_status}`);

      return {
        success: true,
        batchId: response.result.batch_header.payout_batch_id,
        payoutItemId: response.result.items?.[0]?.payout_item_id,
        status: response.result.batch_header.batch_status,
        amount: amount,
        paypalEmail: paypalEmail
      };

    } catch (error) {
      console.error('❌ [PAYPAL] Payout failed:', error.message);
      
      // Extract error details from PayPal response
      let errorMessage = error.message;
      if (error.statusCode) {
        errorMessage = `PayPal Error (${error.statusCode}): ${error.message}`;
      }
      
      throw new Error(errorMessage);
    }
  }

  /**
   * Get payout status
   * @param {string} payoutItemId - PayPal payout item ID
   * @returns {Promise<Object>} Payout status
   */
  async getPayoutStatus(payoutItemId) {
    if (!this.isAvailable()) {
      throw new Error('PayPal service is not configured');
    }

    try {
      const request = new paypal.payouts.PayoutsItemGetRequest(payoutItemId);
      const response = await this.client.execute(request);

      return {
        success: true,
        status: response.result.transaction_status,
        amount: response.result.payout_item.amount.value,
        currency: response.result.payout_item.amount.currency,
        receiver: response.result.payout_item.receiver,
        timeProcessed: response.result.time_processed
      };
    } catch (error) {
      console.error('❌ [PAYPAL] Failed to get payout status:', error.message);
      throw error;
    }
  }
}

// Export singleton instance
module.exports = new PayPalService();

