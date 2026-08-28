function requireUserEmail_() {
  var email = Session.getActiveUser().getEmail();
  if (!email) throw new Error('Not signed in.');
  return String(email).trim().toLowerCase();
}

function userFromApi_(u) {
  if (!u) return null;
  var userType = String(u.userType || USER_TYPE_INTERNAL).trim();
  if (userType !== USER_TYPE_EXTERNAL) userType = USER_TYPE_INTERNAL;
  return {
    email: String(u.email || '')
      .trim()
      .toLowerCase(),
    role: String(u.role || ROLE_FIELD),
    displayName: String(u.displayName || ''),
    active: u.active !== false,
    userType: userType
  };
}

function findUserRow_(email) {
  email = String(email || '')
    .trim()
    .toLowerCase();
  if (!email) return null;
  var selfEmail = '';
  try {
    selfEmail = String(Session.getActiveUser().getEmail() || '')
      .trim()
      .toLowerCase();
  } catch (e) {}
  if (selfEmail && email === selfEmail) {
    var me = ecInternalApiRequest_('get', '/api/v1/equipcare/users/me', null, {
      userEmail: email
    });
    return userFromApi_(me && me.user);
  }
  var all = ecApiGet_('/api/v1/equipcare/users');
  var users = (all && all.users) || [];
  for (var i = 0; i < users.length; i++) {
    if (String(users[i].email || '').toLowerCase() === email) {
      return userFromApi_(users[i]);
    }
  }
  return null;
}

function requireRegisteredUser_() {
  var email = requireUserEmail_();
  var u = findUserRow_(email);
  if (!u || !u.active) {
    throw new Error(
      'Your account is not registered in Asset Management or is inactive. Ask an admin to add: ' + email
    );
  }
  return u;
}

function isAdmin_(u) {
  return String(u.role || '') === ROLE_ADMIN;
}

function isManagerOrAdmin_(u) {
  var r = String(u.role || '');
  return r === ROLE_ADMIN || r === ROLE_MANAGER;
}
