import { iosCommands } from 'appium-ios-driver';
import { retryInterval } from 'asyncbox';
import { util } from 'appium-support';
import log from '../logger';
import _ from 'lodash';
import B from 'bluebird';


const IPHONE_WEB_COORD_SMART_APP_BANNER_OFFSET = 84;
const IPAD_WEB_COORD_SMART_APP_BANNER_OFFSET = 95;

let extensions = {};

Object.assign(extensions, iosCommands.web);

const getSafariIsIphone = _.memoize(async function getSafariIsIphone (sessionId, driver) {
  // sessionId parameter is for memoizing per session
  let isIphone = true;
  try {
    const useragent = await driver.execute('return navigator.userAgent');
    isIphone = useragent.toLowerCase().includes('iphone');
  } catch (err) {
    log.warn(`Unable to find device type from useragent. Assuming iPhone`);
    log.debug(`Error: ${err.message}`);
  }
  return isIphone;
});

extensions.getElementHeightMemoized = _.memoize(async function (key, el) {
  el = util.unwrapElement(el);
  return (await this.getNativeRect(el)).height;
});

extensions.getURLBarHeight = async function () {
  let height = 0;

  // The elements comprising the URL bar are funny: many of them have children which are higher
  // than themselves. We pick the highest one, an invisible nameless button which happens to be
  // the first button in the app.
  const implicitWaitMs = this.implicitWaitMs;
  try {
    this.setImplicitWait(0);
    let weirdButton = await this.findNativeElementOrElements('-ios predicate string', `type = "XCUIElementTypeButton"`, false);
    weirdButton = util.unwrapElement(weirdButton);
    height += (await this.getNativeRect(weirdButton)).height;
  } finally {
    this.setImplicitWait(implicitWaitMs);
  }

  log.debug(`URL bar height: ${height}`);
  return height;
};

/**
 * @returns {Promise.<number>} the total height of the tab bar and app banner elements, if present
 */
extensions.getHeightOfExtraTopElements = async function () {
  let height = 0;

  // keep track of implicit wait, and set locally to 0
  const implicitWaitMs = this.implicitWaitMs;
  try {
    this.setImplicitWait(0);

    // first try to get tab offset
    try {
      const el = await this.findNativeElementOrElements('-ios predicate string', `name LIKE '*, Tab' AND visible = 1`, false);
      height += await this.getElementHeightMemoized('TabBar', el);
      log.debug(`Adding height of tab bar`);
    } catch (ign) {
      // no element found, so no tabs and no need to deal with offset
    }

    // next try to see if there is an Smart App Banner
    try {
      await this.findNativeElementOrElements('accessibility id', 'Close app download offer', false);
      log.debug(`Adding height of app banner`);
      height += await getSafariIsIphone(this.opts.sessionId, this) ?
        IPHONE_WEB_COORD_SMART_APP_BANNER_OFFSET :
        IPAD_WEB_COORD_SMART_APP_BANNER_OFFSET;
    } catch (ign) {
      // no smart app banner found, so continue
    }
  } finally {
    // return implicit wait to what it was
    this.setImplicitWait(implicitWaitMs);
  }

  log.debug(`Extra top elements height: ${height}`);
  return height;
};

extensions.nativeWebTap = async function (el) {
  let atomsElement = this.useAtomsElement(el);
  let {x, y} = await this.executeAtom('get_top_left_coordinates', [atomsElement]);
  let {width, height} = await this.executeAtom('get_size', [atomsElement]);
  x = x + (width / 2);
  y = y + (height / 2);

  this.curWebCoords = {x, y};
  await this.clickWebCoords();
};

extensions.clickCoords = async function (coords) {
  let {x, y} = coords;

  // tap on absolute coordinates
  await this.proxyCommand('/wda/tap/nil', 'POST', {x, y});
};

extensions.getBottomBarHeight = async function () {
  const bars = await this.findNativeElementOrElements("-ios predicate string", "name = 'BottomBrowserToolbar' AND visible = 1", true);
  if (_.size(bars) === 0) {
    return 0;
  } else {
    return await this.getElementHeightMemoized("BottomBrowserToolbar", bars[0]);
  }
};

extensions.getWebviewNativeRect = async function () {
  let webview = await retryInterval(5, 100, async () => {
    const implicitWaitMs = this.implicitWaitMs;
    try {
      this.setImplicitWait(0);
      return await this.findNativeElementOrElements('-ios predicate string', `type = 'XCUIElementTypeWebView' AND visible = 1`, false);
    } finally {
      this.setImplicitWait(implicitWaitMs);
    }
  });

  webview = util.unwrapElement(webview);
  let rect = await this.proxyCommand(`/element/${webview}/rect`, 'GET');
  log.debug(`Reported webview native rect: ${JSON.stringify(rect)}`);

  // The webview always reports its rect to be the same as the whole app, even though it's not.
  // There are various elements above and below it. So we have to account for these elements
  // ourselves.

  let topElementsHeight = await this.getURLBarHeight();
  topElementsHeight += await this.getHeightOfExtraTopElements();

  let bottomElementsHeight = await this.getBottomBarHeight();

  rect.y += topElementsHeight;
  rect.height -= (topElementsHeight + bottomElementsHeight);

  log.debug(`Corrected webview native rect: ${JSON.stringify(rect)}`);
  return rect;
};

extensions.translateWebCoords = async function (coords) {
  log.debug(`Translating web coordinates (${JSON.stringify(coords)}) to native coordinates`);

  let wvNativeRect = await this.getWebviewNativeRect();

  let cmd = '(function () { return {width: window.innerWidth, height: window.innerHeight}; })()';
  let wvWebDims = await this.remote.execute(cmd);

  if (wvWebDims && wvNativeRect) {
    let xRatio = wvNativeRect.width / wvWebDims.width;
    let yRatio = wvNativeRect.height / wvWebDims.height;
    let newCoords = {
      x: wvNativeRect.x + Math.round(xRatio * coords.x),
      y: wvNativeRect.y + Math.round(yRatio * coords.y),
    };

    // additional logging for coordinates, since it is sometimes broken
    //   see https://github.com/appium/appium/issues/9159
    log.debug(`Converted coordinates: ${JSON.stringify(newCoords)}`);
    log.debug(`    rect: ${JSON.stringify(wvNativeRect)}`);
    log.debug(`    wvDims: ${JSON.stringify(wvWebDims)}`);
    log.debug(`    xRatio: ${JSON.stringify(xRatio)}`);
    log.debug(`    yRatio: ${JSON.stringify(yRatio)}`);

    log.debug(`Converted web coords ${JSON.stringify(coords)} ` +
              `into real coords ${JSON.stringify(newCoords)}`);
    return newCoords;
  }
};

extensions.checkForAlert = async function (isRetroactive) {
  let alert_ = null;
  try {
    alert_ = await this.getAlert();
  } catch(err) {
    // No alert found
  }
  if (alert_) {
    let message;
    if (isRetroactive) {
      message = "Alert detected after action had already started." +
        " The action may have an unexpected side effect.";
    } else {
      message = "Alert detected before action performed";
    }
    throw new errors.UnexpectedAlertOpenError(message);
  }
};

extensions.executeAtom = async function (atom, args, alwaysDefaultFrame = false) {
  await this.checkForAlert();
  let frames = alwaysDefaultFrame === true ? [] : this.curWebFrames;
  let promise = this.remote.executeAtom(atom, args, frames);
  return this.waitForAtom(promise);
};

extensions.executeAtomAsync = async function (atom, args, responseUrl) {
  await this.checkForAlert();
  // save the resolve and reject methods of the promise to be waited for
  let promise = new B((resolve, reject) => {
    this.asyncPromise = {resolve, reject};
  });
  await this.remote.executeAtomAsync(atom, args, this.curWebFrames, responseUrl);
  return await this.waitForAtom(promise);
};

extensions.waitForAtom = async function (promise) {
  let res = null;
  let timedOut = false;
  let done = false;
  let error = null;
  // Do the action asynchronously, so we can monitor it for taking too long.
  promise.then((res) => {
    done = true;
    return res;
  })
  .catch((err) => {
    log.debug(`Error received while executing atom: ${err.message}`);
    // error gets swallowed, so save and check later
    done = true;
    error = err;
  });
  // Wait until either action succeeds or it's taking too long and we want to check for alerts.
  let timeoutPromise = B.delay(1000).then(()=>timedOut = true);
  await Promise.race([promise, timeoutPromise]);
  if (timedOut) {
    for (let i = 0; i < 10; i++) {
      if (done) break;
      // check if there is an alert (will throw exception if one is found).
      await this.checkForAlert(true);
      await B.delay(500);
    }
  }
  res = await promise;
  if (error) {
    let msg = _.isString(error.message) ? error.message : JSON.stringify(error.message);
    throw new Error(`Error while executing atom: ${msg}`);
  }
  return this.parseExecuteResponse(res);
};

export default extensions;
