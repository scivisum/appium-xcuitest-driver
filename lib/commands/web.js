import { iosCommands } from 'appium-ios-driver';
import { retryInterval } from 'asyncbox';
import { util } from 'appium-support';
import { errors } from 'appium-base-driver';
import log from '../logger';
import _ from 'lodash';
import B from 'bluebird';


const IPHONE_EXTRA_WEB_COORD_SCROLL_OFFSET = -15;
const IPHONE_EXTRA_WEB_COORD_NON_SCROLL_OFFSET = 10;
const IPHONE_WEB_COORD_OFFSET = -10;
const IPHONE_WEB_COORD_SMART_APP_BANNER_OFFSET = 84;
const IPHONE_X_EXTRA_WEB_COORD_SCROLL_OFFSET = -90;
const IPHONE_X_EXTRA_WEB_COORD_NON_SCROLL_OFFSET = -10;
const IPHONE_X_WEB_COORD_OFFSET = 40;
const IPAD_EXTRA_WEB_COORD_SCROLL_OFFSET = -10;
const IPAD_EXTRA_WEB_COORD_NON_SCROLL_OFFSET = 0;
const IPAD_WEB_COORD_OFFSET = 10;
const IPAD_WEB_COORD_SMART_APP_BANNER_OFFSET = 95;

const IPHONE_X_WIDTH = 375;
const IPHONE_X_HEIGHT = 812;

// eslint-disable-next-line no-unused-vars
const ATOM_WAIT_TIMEOUT = 5 * 60000;
const IPHONE_X_NOTCH_HEIGHT = 44;

let extensions = {};

Object.assign(extensions, iosCommands.web);



extensions.getSafariIsIphone = async function getSafariIsIphone () {
  try {
    const userAgent = await this.execute('return navigator.userAgent');
    return userAgent.toLowerCase().includes('iphone');
  } catch (err) {
    log.warn(`Unable to find device type from useragent. Assuming iPhone`);
    log.debug(`Error: ${err.message}`);
  }
  return true;
};

extensions.getSafariIsIphoneX = async function getSafariIsIphone () {
  try {
    const script = 'return {height: window.screen.availHeight, width: window.screen.availWidth};';
    const {height, width} = await this.execute(script);
    // check for the correct height and width
    return (height === IPHONE_X_HEIGHT && width === IPHONE_X_WIDTH) ||
           (height === IPHONE_X_WIDTH && width === IPHONE_X_HEIGHT);
  } catch (err) {
    log.warn(`Unable to find device type from useragent. Assuming not iPhone X`);
    log.debug(`Error: ${err.message}`);
  }
  return false;
};

const getElementHeightMemoized = _.memoize(async function getElementHeightMemoized (key, driver, el) {
  el = util.unwrapElement(el);
  return (await driver.getNativeRect(el)).height;
});

extensions.getExtraTranslateWebCoordsOffset = async function getExtraTranslateWebCoordsOffset (coords, webviewRect) {
  let offset = 0;

  // keep track of implicit wait, and set locally to 0
  const implicitWaitMs = this.implicitWaitMs;

  const isIphone = await this.getSafariIsIphone();
  const isIphoneX = isIphone && await this.getSafariIsIphoneX();

  try {
    this.setImplicitWait(0);

    // check if the full url bar is up
    await this.findNativeElementOrElements('accessibility id', 'ReloadButton', false);

    // reload button found, which means scrolling has not happened
    if (isIphoneX) {
      offset += IPHONE_X_EXTRA_WEB_COORD_NON_SCROLL_OFFSET;
    } else if (isIphone) {
      offset += IPHONE_EXTRA_WEB_COORD_NON_SCROLL_OFFSET;
    } else {
      offset += IPAD_EXTRA_WEB_COORD_NON_SCROLL_OFFSET;
    }
  } catch (err) {
    // no reload button, which indicates scrolling has happened
    // the URL bar may or may not be visible
    try {
      const el = await this.findNativeElementOrElements('accessibility id', 'URL', false);
      offset -= await getElementHeightMemoized('URLBar', this, el);
    } catch (ign) {
      // no URL elements found, so continue
    }
  } finally {
    // return implicit wait to what it was
    this.setImplicitWait(implicitWaitMs);
  }

  if (coords.y > webviewRect.height) {
    // when scrolling has happened, there is a tick more offset needed
    if (isIphoneX) {
      offset += IPHONE_X_EXTRA_WEB_COORD_SCROLL_OFFSET;
    } else if (isIphone) {
      offset += IPHONE_EXTRA_WEB_COORD_SCROLL_OFFSET;
    } else {
      offset += IPAD_EXTRA_WEB_COORD_SCROLL_OFFSET;
    }
  }

  // extra offset necessary
  offset += isIphone ? IPHONE_WEB_COORD_OFFSET : IPAD_WEB_COORD_OFFSET;

  offset += isIphoneX ? IPHONE_X_WEB_COORD_OFFSET : 0;

  log.debug(`Extra translated web coordinates offset: ${offset}`);
  return offset;
};

extensions.getURLBarHeight = async function getURLBarHeight (rect) {
  let offset = 0;

  // The elements comprising the URL bar are funny: many of them have children which are higher
  // than themselves. We pick the highest one, an invisible nameless button which happens to be
  // the first button in the app.
  const implicitWaitMs = this.implicitWaitMs;
  try {
    this.setImplicitWait(0);

    // Can't trust element visibility in landscape mode, this prevents us from using class chains/predicate strings.
    // https://github.com/facebook/WebDriverAgent/issues/856
    //
    // Don't trust the "weirdButton" check in landscape, because it always has a size, even if it's not visible.
    let navBarVisible = false;
    if (rect.w > rect.h) {
      let topBrowsers = await this.findNativeElementOrElements('-ios predicate string', `name = "TopBrowserToolbar"`, true);
      navBarVisible = _.size(topBrowsers) > 0;
    } else {
      navBarVisible = true;
    }
    if (navBarVisible) {
      let weirdButton = await this.findNativeElementOrElements('-ios predicate string', `type = "XCUIElementTypeButton"`, false);
      weirdButton = util.unwrapElement(weirdButton);
      offset += (await this.getNativeRect(weirdButton)).height;
    }
  } finally {
    // return implicit wait to what it was
    this.setImplicitWait(implicitWaitMs);
  }

  log.debug(`URL bar height: ${offset}`);
  return offset;
};

extensions.getExtraNativeWebTapOffset = async function getExtraNativeWebTapOffset () {
  let offset = 0;

  // keep track of implicit wait, and set locally to 0
  const implicitWaitMs = this.implicitWaitMs;
  try {
    this.setImplicitWait(0);

    // first try to get tab offset
    try {
      const el = await this.findNativeElementOrElements('-ios predicate string', `name LIKE '*, Tab' AND visible = 1`, false);
      offset += await getElementHeightMemoized('TabBar', this, el);
    } catch (ign) {
      // no element found, so no tabs and no need to deal with offset
    }

    // next try to see if there is an Smart App Banner
    try {
      await this.findNativeElementOrElements('accessibility id', 'Close app download offer', false);
      offset += await this.getSafariIsIphone() ?
        IPHONE_WEB_COORD_SMART_APP_BANNER_OFFSET :
        IPAD_WEB_COORD_SMART_APP_BANNER_OFFSET;
    } catch (ign) {
      // no smart app banner found, so continue
    }
  } finally {
    // return implicit wait to what it was
    this.setImplicitWait(implicitWaitMs);
  }

  log.debug(`Additional native web tap offset computed: ${offset}`);
  return offset;
};

// eslint-disable-next-line no-unused-vars
async function tapWebElementNatively (driver, atomsElement) {
  // try to get the text of the element, which will be accessible in the
  // native context
  try {
    let text = await driver.executeAtom('get_text', [atomsElement]);
    if (!text) {
      text = await driver.executeAtom('get_attribute_value', [atomsElement, 'value']);
    }

    if (text) {
      const el = await driver.findNativeElementOrElements('accessibility id', text, false);
      // use tap because on iOS 11.2 and below `nativeClick` crashes WDA
      const rect = await driver.proxyCommand(`/element/${el.ELEMENT}/rect`, 'GET');
      const coords = {
        x: Math.round(rect.x + rect.width / 2),
        y: Math.round(rect.y + rect.height / 2),
      };
      await driver.clickCoords(coords);
      return true;
    }
  } catch (err) {
    // any failure should fall through and trigger the more elaborate
    // method of clicking
    log.warn(`Error attempting to click: ${err.message}`);
  }
  return false;
}

extensions.nativeWebTap = async function nativeWebTap (el) {
  const atomsElement = this.useAtomsElement(el);

  // Reason for not implementing this:
  // https://github.com/scivisum/appium-xcuitest-driver/pull/10

  // `get_top_left_coordinates` returns the wrong value sometimes,
  // unless we pre-call both of these functions before the actual calls
  await this.executeAtom('get_size', [atomsElement]);
  await this.executeAtom('get_top_left_coordinates', [atomsElement]);

  const {width, height} = await this.executeAtom('get_size', [atomsElement]);
  let {x, y} = await this.executeAtom('get_top_left_coordinates', [atomsElement]);
  x += width / 2;
  y += height / 2;

  this.curWebCoords = {x, y};
  await this.clickWebCoords();
};

extensions.clickCoords = async function clickCoords (coords) {
  await this.performTouch([
    {
      action: this.settings.getSettings().useTapInsteadOfPress ? 'tap' : 'press',
      options: coords,
    },
  ]);
};

extensions.getBottomBarHeight = async function getBottomBarHeight () {
  const bars = await this.findNativeElementOrElements('-ios predicate string', `name = 'BottomBrowserToolbar' AND visible = 1`, true);
  let height = null;
  if (_.size(bars) === 0) {
    height = 0;
  } else {
    height = await getElementHeightMemoized('BottomBrowserToolbar', this, bars[0]);
  }

  log.debug(`Bottom bar height: ${height}`);
  return height;
};

extensions.translateWebCoords = async function translateWebCoords (coords) {
  log.debug(`Translating coordinates (${JSON.stringify(coords)}) to web coordinates`);

  // absolutize web coords
  const implicitWaitMs = this.implicitWaitMs;
  let webview;
  try {
    this.setImplicitWait(0);
    webview = await retryInterval(5, 100, async () => {
      return await this.findNativeElementOrElements('class name', 'XCUIElementTypeWebView', false);
    });
  } finally {
    this.setImplicitWait(implicitWaitMs);
  }

  webview = util.unwrapElement(webview);
  const rect = await this.proxyCommand(`/element/${webview}/rect`, 'GET');
  const wvPos = {x: rect.x, y: rect.y};
  const realDims = {w: rect.width, h: rect.height};

  const cmd = '(function () { return {w: window.innerWidth, h: window.innerHeight}; })()';
  const wvDims = await this.remote.execute(cmd);

  const urlBarHeight = await this.getURLBarHeight(realDims); //64?
  wvPos.y += urlBarHeight;

  const bottomElementsHeight = await this.getBottomBarHeight(); //44
  realDims.h -= (bottomElementsHeight + urlBarHeight);

  // add static offset for safari in landscape mode
  let yOffset = this.opts.curOrientation === 'LANDSCAPE' ? this.landscapeWebCoordsOffset : 0;

  // add extra offset for possible extra things in the top of the page
  yOffset += await this.getExtraNativeWebTapOffset();
  // coords.y += await this.getExtraTranslateWebCoordsOffset(coords, rect);

  if (this.opts.deviceName === 'iPhone X') {
    if (this.opts.curOrientation === 'LANDSCAPE') {
      log.debug('Account for the iPhone X notch');
      wvPos.x += IPHONE_X_NOTCH_HEIGHT;
      realDims.w -= IPHONE_X_NOTCH_HEIGHT * 2;
    }
  }

  if (wvDims && realDims && wvPos) {
    // On the iPhone X our "corrected" webview native rect has the wrong height. But the width
    // is correct, so apply the x-ratio to the y-coordinate as well. Keep computing the y-ratio
    // in case it helps debugging.
    let xRatio = realDims.w / wvDims.w;
    let yRatio = realDims.h / wvDims.h;
    let yRatioAdj = this.opts.deviceName === 'iPhone X' ? xRatio : yRatio;
    let newCoords = {
      x: wvPos.x + Math.round(xRatio * coords.x),
      y: wvPos.y + yOffset + Math.round(yRatioAdj * coords.y),
    };

    // additional logging for coordinates, since it is sometimes broken
    //   see https://github.com/appium/appium/issues/9159
    log.debug(`Converted coordinates: ${JSON.stringify(newCoords)}`);
    log.debug(`    rect: ${JSON.stringify(rect)}`);
    log.debug(`    wvPos: ${JSON.stringify(wvPos)}`);
    log.debug(`    realDims: ${JSON.stringify(realDims)}`);
    log.debug(`    wvDims: ${JSON.stringify(wvDims)}`);
    log.debug(`    xRatio: ${JSON.stringify(xRatio)}`);
    log.debug(`    yRatio: ${JSON.stringify(yRatio)}`);
    log.debug(`    yRatioAdj: ${JSON.stringify(yRatioAdj)}`);
    log.debug(`    yOffset: ${JSON.stringify(yOffset)}`);

    log.debug(`Converted web coords ${JSON.stringify(coords)} ` +
              `into real coords ${JSON.stringify(newCoords)}`);
    return newCoords;
  }
};

extensions.checkForAlert = async function checkForAlert (isRetroactive) {
  if (!this.settings.getSettings().checkForModalDialogs) {
    return;
  }
  let alert_ = null;
  try {
    // We need to check for native and js alerts (Location permission is a native alert!)
    alert_ = await this.getAlertText();
  } catch (err) {
    // No alert found
  }

  if (alert_) {
    let message;
    if (isRetroactive) {
      message = 'Alert detected after action had already started.' +
        ' The action may have an unexpected side effect.';
    } else {
      message = 'Alert detected before action performed';
    }
    throw new errors.UnexpectedAlertOpenError(message);
  }
};

extensions.executeAtom = async function executeAtom (atom, args, alwaysDefaultFrame = false) {
  await this.checkForAlert();
  let frames = alwaysDefaultFrame === true ? [] : this.curWebFrames;
  let promise = this.remote.executeAtom(atom, args, frames);
  return this.waitForAtom(promise);
};

extensions.executeAtomAsync = async function executeAtomAsync (atom, args, responseUrl) {
  await this.checkForAlert();
  // save the resolve and reject methods of the promise to be waited for
  let promise = new B((resolve, reject) => {
    this.asyncPromise = {resolve, reject};
  });
  await this.remote.executeAtomAsync(atom, args, this.curWebFrames, responseUrl);
  return await this.waitForAtom(promise);
};

extensions.waitForAtom = async function waitForAtom (promise) {
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
    error = err;
  });
  // Wait until either action succeeds or it's taking too long and we want to check for alerts.
  let timeoutPromise = B.delay(1000).then(() => timedOut = true);
  // eslint-disable-next-line promise/no-native
  await Promise.race([promise, timeoutPromise]);
  if (timedOut) {
    for (let i = 0; i < 10; i++) {
      if (done) {
        break;
      }
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
