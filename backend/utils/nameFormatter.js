/**
 * Format user name as "First L." (First name + Last initial)
 * Handles various user object structures and fallbacks
 * 
 * @param {Object|String} user - User object or name string
 * @returns {String} Formatted name like "Phillip D."
 */
function formatNameWithInitial(user) {
  if (!user) return 'User';
  
  // Handle if it's already a formatted string
  if (typeof user === 'string') {
    return formatStringName(user);
  }
  
  // Handle user object
  const firstName = user.firstName || 
                   (user.name && user.name.split(' ')[0]) || 
                   (user.email && user.email.split('@')[0]) ||
                   'User';
  
  const lastName = user.lastName || 
                   (user.name && user.name.split(' ').slice(1).join(' ')) ||
                   '';
  
  const lastInitial = lastName ? `${lastName.charAt(0).toUpperCase()}.` : '';
  return lastInitial ? `${firstName} ${lastInitial}` : firstName;
}

/**
 * Format a string name as "First L."
 * Handles emails, full names, etc.
 * 
 * @param {String} name - Name string (could be email, full name, etc.)
 * @returns {String} Formatted name
 */
function formatStringName(name) {
  if (!name || typeof name !== 'string') return 'User';
  
  const trimmed = name.trim();
  if (!trimmed) return 'User';
  
  // If it's an email, extract the name part
  if (trimmed.includes('@')) {
    const base = trimmed.split('@')[0];
    const parts = base.split(/[.\s_]+/).filter(Boolean);
    if (parts.length === 0) return 'User';
    
    const first = parts[0];
    const lastInitial = parts.length > 1 ? parts[parts.length - 1][0].toUpperCase() : '';
    return lastInitial ? `${capitalize(first)} ${lastInitial}.` : capitalize(first);
  }
  
  // Split by spaces
  const parts = trimmed.split(' ').filter(Boolean);
  if (parts.length === 0) return 'User';
  if (parts.length === 1) return capitalize(parts[0]);
  
  const first = capitalize(parts[0]);
  const last = parts[parts.length - 1];
  const lastInitial = last ? last[0].toUpperCase() : '';
  return lastInitial ? `${first} ${lastInitial}.` : first;
}

/**
 * Capitalize first letter of a string
 * 
 * @param {String} str - String to capitalize
 * @returns {String} Capitalized string
 */
function capitalize(str) {
  if (!str) return '';
  return str.charAt(0).toUpperCase() + str.slice(1).toLowerCase();
}

module.exports = {
  formatNameWithInitial,
  formatStringName,
  capitalize
};




