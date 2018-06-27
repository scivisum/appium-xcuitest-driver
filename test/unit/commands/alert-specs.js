import sinon from 'sinon';
import XCUITestDriver from '../../..';
import chai from 'chai';
import chaiAsPromised from 'chai-as-promised';

import { errors } from 'appium-base-driver';

chai.should();
chai.use(chaiAsPromised);

describe('alert commands', function () {
  let driver = new XCUITestDriver();
  let proxySpy = sinon.stub(driver, 'proxyCommand');

  afterEach(function () {
    proxySpy.reset();
  });

  describe('getAlertText', function () {
    it('should send translated GET request to WDA', async function () {
      await driver.getAlertText();
      proxySpy.calledOnce.should.be.true;
      proxySpy.firstCall.args[0].should.eql('/alert/text');
      proxySpy.firstCall.args[1].should.eql('GET');
    });
  });
  describe('setAlertText', function () {
    it('should send translated POST request to WDA', async function () {
      await driver.setAlertText('some text');
      proxySpy.calledOnce.should.be.true;
      proxySpy.firstCall.args[0].should.eql('/alert/text');
      proxySpy.firstCall.args[1].should.eql('POST');
      proxySpy.firstCall.args[2].should.eql({value:
        ['s', 'o', 'm', 'e', ' ', 't', 'e', 'x', 't'],
      });
    });
  });
  describe('postAcceptAlert', function () {
    it('should send translated POST request to WDA', async function () {
      await driver.postAcceptAlert();
      proxySpy.calledOnce.should.be.true;
      proxySpy.firstCall.args[0].should.eql('/alert/accept');
      proxySpy.firstCall.args[1].should.eql('POST');
    });
  });
  describe('postDismissAlert', function () {
    it('should send translated POST request to WDA', async function () {
      await driver.postDismissAlert();
      proxySpy.calledOnce.should.be.true;
      proxySpy.firstCall.args[0].should.eql('/alert/dismiss');
      proxySpy.firstCall.args[1].should.eql('POST');
    });
  });

  describe('getAlert', function () {
    let scrollView = sinon.stub();
    scrollView.ELEMENT = "mockscrollelement";

    it('returns successfully if an alert is present', async function () {
      let button = sinon.stub(),
          alert;
      button.ELEMENT = "mockbuttonelement";
      proxySpy.onCall(0).returns([scrollView]);
      proxySpy.onCall(1).returns({count: 1});
      proxySpy.onCall(2).returns({count: 1});
      proxySpy.onCall(3).returns([button]);
      proxySpy.onCall(4).returns("close");

      alert = await driver.getAlert();

      proxySpy.getCall(0).args[0].should.eql('/elements');
      proxySpy.getCall(0).args[2].should.eql({
        using: 'class name', value: 'XCUIElementTypeScrollView', countOnly: false
      });
      proxySpy.getCall(1).args[0].should.eql('/element/mockscrollelement/elements');
      proxySpy.getCall(1).args[2].should.eql({
        using: 'class name', value: 'XCUIElementTypeTextView', countOnly: true
      });
      proxySpy.getCall(2).args[0].should.eql('/element/mockscrollelement/elements');
      proxySpy.getCall(2).args[2].should.eql({
        using: 'class name', value: 'XCUIElementTypeButton', countOnly: true
      });
      proxySpy.getCall(3).args[0].should.eql('/element/mockscrollelement/elements');
      proxySpy.getCall(3).args[2].should.eql({
        using: 'class name', value: 'XCUIElementTypeButton', countOnly: false
      });
      proxySpy.getCall(4).args[0].should.eql('/element/mockbuttonelement/attribute/name');
      alert.should.eql(scrollView);
    });

    it('returns successfully if a confirm is present', async function () {
      let button1 = sinon.stub(),
          button2 = sinon.stub(),
          alert;
      button1.ELEMENT = "mockbuttonelement1";
      button2.ELEMENT = "mockbuttonelement2";
      proxySpy.onCall(0).returns([scrollView]);
      proxySpy.onCall(1).returns({count: 1});
      proxySpy.onCall(2).returns({count: 2});
      proxySpy.onCall(3).returns([button1, button2]);
      proxySpy.onCall(4).returns("cancel");
      proxySpy.onCall(5).returns("ok");

      alert = await driver.getAlert();

      proxySpy.callCount.should.equal(6);
      proxySpy.getCall(4).args[0].should.eql('/element/mockbuttonelement1/attribute/name');
      proxySpy.getCall(5).args[0].should.eql('/element/mockbuttonelement2/attribute/name');
      alert.should.eql(scrollView);
    });
    it('throws on incorrect number of TextViews', async function () {
      proxySpy.onCall(0).returns([scrollView]);
      proxySpy.onCall(1).returns({count: 0});

      await driver.getAlert().should.be.rejectedWith(errors.NoAlertOpenError);
      proxySpy.callCount.should.equal(2);
    });
    it('throws on incorrect number of Buttons', async function () {
      proxySpy.onCall(0).returns([scrollView]);
      proxySpy.onCall(1).returns({count: 1});
      proxySpy.onCall(2).returns({count: 3});

      await driver.getAlert().should.be.rejectedWith(errors.NoAlertOpenError);
      proxySpy.callCount.should.equal(3);
    });
  });

  describe('mobile: alert', function () {
    const commandName = 'alert';

    it('should reject request to WDA if action parameter is not supported', async function () {
      await driver.execute(`mobile: ${commandName}`, {action: 'blabla'})
        .should.be.rejectedWith(/should be either/);
    });

    it('should send accept alert request to WDA with encoded button label', async function () {
      const buttonLabel = 'some label';
      await driver.execute(`mobile: ${commandName}`, {action: 'accept', buttonLabel});
      proxySpy.calledOnce.should.be.true;
      proxySpy.firstCall.args[0].should.eql('/alert/accept');
      proxySpy.firstCall.args[1].should.eql('POST');
      proxySpy.firstCall.args[2].should.have.property('name', buttonLabel);
    });

    it('should send dimsiss alert request to WDA if button label is not provided', async function () {
      await driver.execute(`mobile: ${commandName}`, {action: 'dismiss'});
      proxySpy.calledOnce.should.be.true;
      proxySpy.firstCall.args[0].should.eql(`/alert/dismiss`);
      proxySpy.firstCall.args[1].should.eql('POST');
    });

    it('should send get alert buttons request to WDA', async function () {
      const buttonLabel = 'OK';
      proxySpy.returns({value: [buttonLabel], sessionId: '05869B62-C559-43AD-A343-BAACAAE00CBB', status: 0});
      const response = await driver.execute(`mobile: ${commandName}`, {action: 'getButtons'});
      proxySpy.calledOnce.should.be.true;
      proxySpy.firstCall.args[0].should.eql('/wda/alert/buttons');
      proxySpy.firstCall.args[1].should.eql('GET');
      response.value[0].should.be.equal(buttonLabel);
    });
  });
});
