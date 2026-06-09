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
 * Same as formatNameWithInitial but without the period after the last initial
 * (e.g. "Phillip D" not "Phillip D."). Use in comma-separated lists so you
 * do not get awkward "., " between names ("Phillip D., Elena V.,").
 *
 * @param {Object|String} user
 * @returns {String}
 */
function formatNameWithInitialListStyle(user) {
  const s = formatNameWithInitial(user);
  return s.replace(/ ([A-Za-z])\.$/, ' $1');
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

/**
 * First name only for friendly salutations (e.g. "Hi Phil," not "Hi Phil D.,").
 */
function formatFirstName(user) {
  if (!user) return 'User';

  if (typeof user === 'string') {
    const trimmed = user.trim();
    if (!trimmed) return 'User';
    if (trimmed.includes('@')) {
      const base = trimmed.split('@')[0];
      const part = base.split(/[.\s_]+/).filter(Boolean)[0];
      return part ? capitalize(part) : 'User';
    }
    const part = trimmed.split(' ').filter(Boolean)[0];
    return part ? capitalize(part) : 'User';
  }

  const firstName = user.firstName
    || (user.name && user.name.split(' ')[0])
    || (user.email && user.email.split('@')[0].split(/[.\s_]+/)[0])
    || 'User';

  return capitalize(firstName);
}

module.exports = {
  formatNameWithInitial,
  formatNameWithInitialListStyle,
  formatStringName,
  formatFirstName,
  capitalize
};







