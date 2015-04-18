var defaultSettings = {
  focusDuration: 25,
  breakDuration: 5,
  showDesktopNotification: true,
  showNewTabNotification: true
};

function Timer(durationSec, tickSec) {
  var self = this;
  var state = 'stopped';

  this.tickInterval = null;
  this.expireTimeout = null;

  this.periodStartTime = null;
  this.remainingSec = null;

  this.start = function() {
    if (state !== 'stopped') {
      return;
    }

    this.expireTimeout = createExpireTimeout(durationSec);
    this.tickInterval = createTickInterval(tickSec);

    this.remainingSec = durationSec;

    state = 'running';
    this.periodStartTime = Date.now();
    this.emitEvent('start', [{
      elapsed: 0,
      remaining: this.remainingSec
    }]);
  };

  this.stop = function() {
    if (state === 'stopped') {
      return;
    }

    clearInterval(this.tickInterval);
    clearTimeout(this.expireTimeout);

    this.tickInterval = null;
    this.expireTimeout = null;
    this.periodStartTime = null;
    this.remainingSec = null;

    state = 'stopped';
    this.emitEvent('stop', [{}]);
  };

  this.pause = function() {
    if (state !== 'running') {
      return;
    }

    clearInterval(this.tickInterval);
    clearTimeout(this.expireTimeout);

    var periodSec = (Date.now() - this.periodStartTime) / 1000;
    this.remainingSec -= periodSec;

    state = 'paused';
    this.periodStartTime = null;
    this.emitEvent('pause', [{
      elapsed: durationSec - this.remainingSec,
      remaining: this.remainingSec
    }]);
  };

  this.resume = function() {
    if (state !== 'paused') {
      return;
    }

    this.expireTimeout = createExpireTimeout(this.remainingSec);
    this.tickInterval = createTickInterval(tickSec);

    state = 'running';
    this.periodStartTime = Date.now();
    this.emitEvent('resume', [{
      elapsed: durationSec - this.remainingSec,
      remaining: this.remainingSec
    }]);
  };

  this.reset = function() {
    this.stop();
    this.start();
  };

  this.state = function() {
    return state;
  };

  function createExpireTimeout(seconds) {
    return setTimeout(function() {
      clearInterval(self.tickInterval);
      clearTimeout(self.expireTimeout);

      self.tickInterval = null;
      self.expireTimeout = null;
      self.periodStartTime = null;
      self.remainingSec = null;

      state = 'stopped';
      self.emitEvent('expire', [{
        elapsed: durationSec,
        remaining: 0
      }]);
    }, seconds * 1000);
  }

  function createTickInterval(seconds) {
    return setInterval(function() {
      var periodSec = (Date.now() - self.periodStartTime) / 1000;
      var remainingSec = self.remainingSec - periodSec;

      self.emitEvent('tick', [{
        elapsed: durationSec - remainingSec,
        remaining: remainingSec
      }]);
    }, seconds * 1000);
  }
}

Timer.prototype = Object.create(EventEmitter.prototype);

function BadgeObserver() {
}

BadgeObserver.observe = function(timer, title, color) {
  timer.addListener('start', function(state) {
    updateBadge({ minutes: Math.round(state.remaining / 60) });
  });

  timer.addListener('tick', function(state) {
    updateBadge({ minutes: Math.round(state.remaining / 60) });
  });

  timer.addListener('stop', function() {
    removeBadge();
  });

  timer.addListener('pause', function() {
    updateBadge({ text: '—', title: 'Paused' });
  });

  timer.addListener('resume', function(state) {
    updateBadge({ minutes: Math.round(state.remaining / 60) });
  });

  timer.addListener('expire', function() {
    removeBadge();
  });

  function updateBadge(options) {
    var minutes = options.minutes;
    if (minutes != null) {
      text = ((minutes == 0) ? '<1' : minutes)  + 'm';
      badgeTitle = title + ': ' + minutes + 'm remaining.';
    } else {
      text = options.text;
      badgeTitle = title + ': ' + options.title;
    }

    chrome.browserAction.setTitle({ title: badgeTitle });
    chrome.browserAction.setBadgeText({ text: text });
    chrome.browserAction.setBadgeBackgroundColor({ color: color });
  };

  function removeBadge() {
    chrome.browserAction.setTitle({ title: '' });
    chrome.browserAction.setBadgeText({ text: '' });
  }
}

function ContextMenuObserver() {
}

ContextMenuObserver.observe = function(controller, timer) {
  timer.addListener('start', function() {
    addPause();
    addStop();
    removeResume();
  });

  timer.addListener('pause', function() {
    addResume();
    addStop();
    removePause();
  });

  timer.addListener('resume', function() {
    addPause();
    addStop();
    removeResume();
  });

  timer.addListener('stop', function() {
    removePause();
    removeStop();
    removeResume();
  });

  timer.addListener('expire', function() {
    removePause();
    removeStop();
    removeResume();
  });

  function addStop() {
    removeStop();
    chrome.contextMenus.create({
      id: 'stop',
      title: 'Stop',
      contexts: ['browser_action'],
      onclick: function() {
        controller.stop();
      }
    });
  }

  function removeStop() {
    chrome.contextMenus.remove('stop', function() { });
  }

  function addPause() {
    removePause();
    chrome.contextMenus.create({
      id: 'pause',
      title: 'Pause',
      contexts: ['browser_action'],
      onclick: function() {
        controller.pause();
      }
    });
  }

  function removePause() {
    chrome.contextMenus.remove('pause', function() { });
  }

  function addResume() {
    removeResume();
    chrome.contextMenus.create({
      id: 'resume',
      title: 'Resume',
      contexts: ['browser_action'],
      onclick: function() {
        controller.resume();
      }
    });
  }

  function removeResume() {
    chrome.contextMenus.remove('resume', function() { });
  }
};

function Controller() {
  var self = this;
  var focusNext = true;
  var focusTimer;
  var breakTimer;

  this.startSession = function() {
    focusTimer.stop();
    breakTimer.stop();

    if (focusNext) {
      focusTimer.start();
    } else {
      breakTimer.start();
    }
  };

  this.browserAction = function() {
    if (focusTimer.state() === 'running') {
      focusTimer.pause();
    } else if (breakTimer.state() === 'running') {
      breakTimer.pause();
    } else if (focusTimer.state() === 'paused') {
      focusTimer.resume();
    } else if (breakTimer.state() === 'paused') {
      breakTimer.resume();
    } else {
      this.startSession();
    }
  };

  this.pause = function() {
    if (focusTimer.state() === 'running') {
      focusTimer.pause();
    } else if (breakTimer.state() === 'running') {
      breakTimer.pause();
    }
  };

  this.stop = function() {
    focusTimer.stop();
    breakTimer.stop();
  };

  this.resume = function() {
    if (focusTimer.state() === 'paused') {
      focusTimer.resume();
    } else if (breakTimer.state() === 'paused') {
      breakTimer.resume();
    }
  };

  this.startBreak = function() {
    focusTimer.stop();
    breakTimer.stop();
    breakTimer.start();
  };

  this.startFocus = function() {
    focusTimer.stop();
    breakTimer.stop();
    focusTimer.start();
  };

  this.focusNext = function() {
    return focusNext;
  };

  this.getSettings = function(callback) {
    chrome.storage.sync.get(function(result) {
      if (Object.keys(result).length == 0) {
        chrome.storage.sync.set(defaultSettings, function() {
          callback(defaultSettings);
        });
      } else {
        callback(result);
      }
    });
  };

  this.setSettings = function(settings, callback) {
    chrome.storage.sync.set(settings, function() {
      createTimers();
      callback();
    });
  };

  function showExpirePage() {
    chrome.tabs.create({ url: chrome.extension.getURL('expire/expire.html') });
  }

  function notify(title, message) {
    var notification = {
      type: 'basic',
      title: title,
      message: message,
      iconUrl: '../icons/128.png'
    };

    chrome.notifications.create('', notification, function() { });
  }

  function createTimers() {
    self.getSettings(function(settings) {
      if (focusTimer) {
        focusTimer.stop();
      }

      focusTimer = createFocusTimer(settings);

      if (breakTimer) {
        breakTimer.stop();
      }

      breakTimer = createBreakTimer(settings);
    });
  }

  function createFocusTimer(settings) {
    var timer = new Timer(settings.focusDuration * 60, 60);
    BadgeObserver.observe(timer, 'Focus', '#cc0000');
    ContextMenuObserver.observe(self, timer);

    timer.addListener('expire', function() {
      focusNext = false;

      if (settings.showDesktopNotification) {
        notify('Take a break!', "Start your break when you're ready");
      }

      if (settings.showNewTabNotification) {
        showExpirePage();
      }
    });

    timer.addListener('start', closeExtensionTabs);

    return timer;
  }

  function createBreakTimer(settings) {
    var timer = new Timer(settings.breakDuration * 60, 60);
    BadgeObserver.observe(timer, 'Break', '#00cc00');
    ContextMenuObserver.observe(self, timer);

    timer.addListener('expire', function() {
      focusNext = true;

      if (settings.showDesktopNotification) {
        notify('Break finished', "Start your focus session when you're ready");
      }

      if (settings.showNewTabNotification) {
        showExpirePage();
      }
    });

    timer.addListener('start', closeExtensionTabs);

    return timer;
  }

  function closeExtensionTabs() {
    var id = chrome.runtime.id;
    var extensionUrl = 'chrome-extension://' + id;

    chrome.tabs.query({}, function(tabs) {
      var remove = [];
      for (var i = 0; i < tabs.length; ++i) {
        if (tabs[i].url.indexOf(extensionUrl) !== -1) {
          remove.push(tabs[i].id);
        }
      }

      chrome.tabs.remove(remove, function() { });
    });
  }

  createTimers();
}

chrome.contextMenus.removeAll();

chrome.contextMenus.create({
  id: 'start-focus',
  title: 'Begin focusing',
  contexts: ['browser_action'],
  onclick: function() {
    controller.startFocus();
  }
});

chrome.contextMenus.create({
  id: 'start-break',
  title: 'Begin break',
  contexts: ['browser_action'],
  onclick: function() {
    controller.startBreak();
  }
});

chrome.contextMenus.create({
  id: 'separator',
  type: 'separator',
  contexts: ['browser_action']
});

var controller = new Controller();

chrome.browserAction.onClicked.addListener(function() {
  controller.browserAction();
});

chrome.runtime.onMessage.addListener(function(request, sender, respond) {
  if (request.command == 'get-session') {
    if (controller.focusNext()) {
      controller.getSettings(function(settings) {
        respond({
          focusNext: true,
          title: 'Break finished',
          subtitle: "Start your " + settings.focusDuration + " minute focus session when you're ready",
          action: 'Start Focusing'
        });
      });
    } else {
      controller.getSettings(function(settings) {
        respond({
          focusNext: false,
          title: 'Take a break!',
          subtitle: "Start your " + settings.breakDuration + " minute break when you're ready",
          action: 'Start Break'
        });
      });
    }
  } else if (request.command == 'start-session') {
    controller.startSession();
    respond({});
  } else if (request.command == 'get-settings') {
    controller.getSettings(respond);
  } else if (request.command == 'set-settings') {
    var newSettings = request.settings;
    var focusDuration = newSettings.focusDuration.trim();
    var breakDuration = newSettings.breakDuration.trim();

    if (!focusDuration) {
      respond({ error: 'Focus duration is required.' });
      return true;
    } else if (!breakDuration) {
      respond({ error: 'Break duration is required.' });
      return true;
    }

    var focusParsed = +focusDuration;
    var breakParsed = +breakDuration;

    if (focusParsed <= 0 || isNaN(focusParsed)) {
      respond({ error: 'Focus duration must be a positive number.' });
      return true;
    } else if (breakParsed <= 0 || isNaN(breakParsed)) {
      respond({ error: 'Break duration must be a positive number.' });
      return true;
    }

    newSettings.focusDuration = focusParsed;
    newSettings.breakDuration = breakParsed;

    controller.setSettings(newSettings, function() {
      respond({});
    });
  }

  return true;
});