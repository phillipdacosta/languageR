/**
 * Feedback Quality Service
 * Analyzes tutor feedback quality and calculates scoring
 */

class FeedbackQualityService {
  
  /**
   * Calculate quality score for tutor feedback
   * @param {Object} tutorNote - The tutor's feedback
   * @param {string} tutorNote.text - Rich text content
   * @param {string} tutorNote.quickImpression - Quick tag
   * @param {string} tutorNote.homework - Homework assignment
   * @returns {number} Quality score (0-100)
   */
  calculateQualityScore(tutorNote) {
    if (!tutorNote || !tutorNote.text) {
      return 0;
    }
    
    let score = 0;
    
    // 1. TEXT CONTENT ANALYSIS (60 points max)
    const textScore = this.analyzeTextQuality(tutorNote.text);
    score += textScore;
    
    // 2. QUICK IMPRESSION (15 points)
    if (tutorNote.quickImpression) {
      score += 15;
    }
    
    // 3. HOMEWORK ASSIGNMENT (25 points)
    if (tutorNote.homework && tutorNote.homework.trim().length > 0) {
      const homeworkScore = this.analyzeHomeworkQuality(tutorNote.homework);
      score += homeworkScore;
    }
    
    return Math.min(100, Math.round(score));
  }
  
  /**
   * Analyze text quality (60 points max)
   */
  analyzeTextQuality(text) {
    if (!text || text.trim().length === 0) return 0;
    
    let score = 0;
    const cleanText = this.stripHtmlTags(text);
    const wordCount = cleanText.split(/\s+/).filter(w => w.length > 0).length;
    const sentences = cleanText.split(/[.!?]+/).filter(s => s.trim().length > 0);
    
    // Word count scoring (25 points)
    if (wordCount >= 100) score += 25;
    else if (wordCount >= 50) score += 20;
    else if (wordCount >= 30) score += 15;
    else if (wordCount >= 15) score += 10;
    else score += 5;
    
    // Structure scoring (20 points)
    if (sentences.length >= 3) score += 10; // Multiple sentences
    if (this.hasStructuredContent(cleanText)) score += 10; // Bullet points, sections
    
    // Specificity scoring (15 points)
    const specificityScore = this.analyzeSpecificity(cleanText);
    score += specificityScore;
    
    return score;
  }
  
  /**
   * Check for structured content (bullet points, sections)
   */
  hasStructuredContent(text) {
    // Check for bullets, numbers, or section markers
    const hasLists = /[-•*]\s|^\d+\.|strengths:|improvements:|focus on:/im.test(text);
    return hasLists;
  }
  
  /**
   * Analyze specificity (15 points max)
   */
  analyzeSpecificity(text) {
    let score = 0;
    const lowerText = text.toLowerCase();
    
    // Keywords indicating specific feedback
    const specificKeywords = [
      'grammar', 'pronunciation', 'vocabulary', 'fluency',
      'conjugation', 'tense', 'article', 'preposition',
      'phrase', 'expression', 'accent', 'intonation',
      'sentence structure', 'word order', 'verb', 'noun',
      'practice', 'improve', 'focus', 'work on'
    ];
    
    const matchCount = specificKeywords.filter(kw => lowerText.includes(kw)).length;
    
    if (matchCount >= 5) score += 15;
    else if (matchCount >= 3) score += 10;
    else if (matchCount >= 1) score += 5;
    
    return score;
  }
  
  /**
   * Analyze homework quality (25 points max)
   */
  analyzeHomeworkQuality(homework) {
    if (!homework || homework.trim().length === 0) return 0;
    
    let score = 0;
    const wordCount = homework.split(/\s+/).filter(w => w.length > 0).length;
    
    // Homework length (15 points)
    if (wordCount >= 30) score += 15;
    else if (wordCount >= 20) score += 12;
    else if (wordCount >= 10) score += 10;
    else score += 5;
    
    // Actionable homework (10 points)
    const actionableWords = ['practice', 'review', 'write', 'read', 'study', 'memorize', 'listen', 'watch', 'complete', 'prepare', 'focus'];
    const hasActionable = actionableWords.some(word => homework.toLowerCase().includes(word));
    if (hasActionable) score += 10;
    
    return score;
  }
  
  /**
   * Strip HTML tags from rich text
   */
  stripHtmlTags(html) {
    if (!html) return '';
    return html.replace(/<[^>]*>/g, '').trim();
  }
}

module.exports = FeedbackQualityService;




