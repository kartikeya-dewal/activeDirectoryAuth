var express = require('express');
var router = express.Router();
var passport = require('passport');
const { check, validationResult } = require('express-validator/check');
var rds = require('../services/remote-desktop-service');
const ad = require('../services/active-directory');
const db = require('../services/db');
var _ = require('lodash');

/* GET admin listing. */
router.get('/', (req, res, next) => {
	if (req.isAuthenticated()) {
		res.redirect('/admin/dashboard');
	}
	else {
		res.render('admin-login', { page: 'MyDesktop Admin', menuId: 'admin-login', errors: null });
	}
});

/* POST login credentials. */
router.post('/login',
	[check('username', 'Username is required').not().isEmpty(),
	check('password', 'Password is required').not().isEmpty()], (req, res, next) => {
		const PAGE = 'MyDesktop Admin';
		const errors = validationResult(req);
		if (!errors.isEmpty()) {
			res.render('admin-login', { page: PAGE, menuId: 'admin', errors: errors.array() });
		} else {
			ad.user(req.body.username).authenticate(req.body.password).then(result => {
				console.log('Result: ', result);
				if (result) {
					user.username = req.body.username;
					ad.user(user.username).isMemberOf(process.env.ADMIN_GROUP).then(result => {
						if (result) {
							ad.user(user.username).get().then(adUser => {
								console.log('Name: ', adUser.displayName);
								user.name = adUser.displayName;

								req.login(user.username, function (err) {
									res.redirect('/admin/dashboard');
								});
							});
						} else {
							var errors = [{ msg: `${user.username} is not a member of MyDesktopAdmin group` }];
							res.render('admin-login', { page: PAGE, menuId: 'admin-login', errors: errors });
						}
					});
				}
				else {
					var errors = [{ msg: 'Invalid Credentials' }];
					res.render('admin-login', { page: PAGE, menuId: 'admin-login', errors: errors });
				}

			}).catch(err => {
				console.log('Authentication failed:', err);
			});
		}
	});

router.get('/dashboard', authenticationMiddleware(), (req, res, next) => {
	const PAGE = 'Admin Dashboard';
	db.getAllUsers().then(results => {
		res.render('admin-dashboard', { page: PAGE, menuId: 'admin-dashboard', user: user, vdiusers: results });
	});
});

/** CreateInstance */
router.post('/createInstance', function (req, res, next) {
	var instanceId = '';
	var instanceIP = null;
	rds.createInstance(req.body.username).then(result => {
		console.log(`Username: ${req.body.username}`);
		console.log(`Instance created: ${result}`);
		instanceId = result.InstanceId;
		db.assignInstance(instanceId,'Stopped', req.body.username).then(() => {
			res.json({
				instanceId: instanceId,
				created: true
			});
		});
	});
});

/** ReleaseInstance */
router.post('/releaseInstance', function (req, res, next) {
	var released = false;
	var dbUpdated = false;
	rds.deleteInstance(req.body.instanceId).then(result => {
		released = true;
		db.updateUser(null, null, req.body.username).then(() => {
			dbUpdated = true;
			res.json({
				released: released,
				dbUpdated: dbUpdated
			});
		});
	});
});

router.get('/loadUsers', function (req, res) {
	ad.user().get().then(users => {
		var vdiusers = _.filter(users, _.flow(
			_.property('groups'),
			_.partialRight(_.some, { cn: process.env.STUDENT_GROUP })
		));
		vdiusers.forEach(user => {
			db.ifUserExists(user.sAMAccountName).then(result => {
				if (!result.length) {
					db.saveUser(user.sAMAccountName, user.displayName);
				}
			});
		});
		res.json({
			synced: true
		});
	});
});

/** Bind Elastic IP */
router.put('/bindip', function (req, res) {
	rds.getAvailableEipAddresses().then(ipaddresses => {
		var ip = ipaddresses[0].IpAddress;
		var allocationId = ipaddresses[0].AllocationId;
		rds.associateEipAddress(req.body.instanceId, allocationId).then(() => {
			db.updateIp(ip, allocationId, req.body.username).then(() => {
				res.json({ instanceIp: ip, binded: true });
			});
		}).catch(err => {
			console.error(err);
			res.json({ binded: false });
		});
	});
});

/** Unbind Elastic IP */
router.put('/unbindip', function (req, res) {
	db.getIpDetails(req.body.username).then(result => {
		rds.unassociateEipAddress(req.body.instanceId, result[0].ipAllocationId).then(() => {
			db.updateIp(null, null, req.body.username).then(() => {
				res.json({ unbinded: true });
			});
		});
	});
});

passport.serializeUser(function (username, done) {
	done(null, username);
});

passport.deserializeUser(function (username, done) {
	done(null, username);
});

function authenticationMiddleware() {
	return (req, res, next) => {
		if (req.isAuthenticated()) {
			return next();
		}
		res.redirect('/admin');
	}
}

var user = {
	username: '',
	name: ''
}
module.exports = router;
