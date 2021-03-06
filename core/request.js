var constants = require('./constants');
var utils = require('./utils');
var Session = require('./session');
var loginLib = require('./login');
var noop = function noop() {};   // 空操作

var buildSessionHeader = function buildSessionHeader(){
    var session = Session.get();
    var header  = {};
    if(session && session.id && session.skey){
        header[constants.WX_HEADER_ID] = session.id;
        header[constants.WX_HEADER_SKEY] = session.skey;
    }
    return header;
};

/***
 * @class
 * 表示请求过程中发生的异常
 */
var RequestError = (function () {
    function RequestError(type, message) {
        Error.call(this, message);
        this.type = type;
        this.message = message;
    }
    RequestError.prototype = new Error();
    RequestError.prototype.constructor = RequestError;
    return RequestError;
})();

function request(options){
    if (typeof options !== 'object') {
        var message = '请求传参应为 object 类型，但实际传了 ' + (typeof options) + ' 类型';
        throw new RequestError(constants.ERR_INVALID_PARAMS, message);
    }

    var requireAuth  = options.auth;
    var requireLogin = options.login;
    var success      = options.success || noop;
    var fail         = options.fail || noop;
    var complete     = options.complete || noop;
    var originHeader = options.header || {};

    // 成功回调
    var callSuccess = function () {
        success.apply(null, arguments);
        complete.apply(null, arguments);
    };
    // 失败回调
    var callFail = function (error) {
        fail.call(null, error);
        complete.call(null, error);
    };

    // 是否已经进行过重试
    var hasRetried = false;
    if (requireLogin) {
        doRequestWithLogin();
    } else {
        doRequest();
    }

     // 登录后再请求
    function doRequestWithLogin() {
        loginLib.login({ success: doRequest, fail: callFail });
    }

    // 实际进行请求的方法
    function doRequest() {
        var authHeader = buildSessionHeader();
        wx.request(utils.extend({},options,{
            header:utils.extend({},originHeader,authHeader),
            success:function(response){
                console.log(response);
                var data = response.data;
                if(!requireAuth)
                {
                    if(data.code == constants.WX_SUCCESS_CODE)
                    {
                        callSuccess.apply(null, arguments);
                    }
                    else{
                        callFail.apply(null, arguments);
                    }
                    return;
                }
            
                if(data && data[constants.WX_SESSION_MAGIC_ID]){  // 鉴权失败
                    // 清除登录态
                    Session.clear();
                    var error, message;
                    if(data.code == constants.MA_SKEY_EXPIRED)  // SKEY过期
                    {                  
                        // 如果是登录态无效，并且还没重试过，会尝试登录后刷新凭据重新请求
                        if (!hasRetried) {
                            hasRetried = true;
                            doRequestWithLogin();
                            return;
                        }
                        message = '登录态已过期';
                        error = new RequestError(data.code, message);
                    }
                    else{
                        message = '鉴权服务器检查登录态发生错误(' + (data.code || 'OTHER') + ')：' + (data.msg || '未知错误');
                        error = new RequestError(constants.ERR_CHECK_LOGIN_FAILED, message);          
                    }
                    callFail(error);
                    return;
                }
                else{  // 每次带回的Session信息缓存
                    if (data && data.session) {
                        Session.set(data.session);
                    }
                    callSuccess.apply(null, arguments);
                }
            },
            fail: callFail,
            complete: noop,
        }));
    }
}

module.exports = {
    RequestError: RequestError,
    request: request,
    buildSessionHeader: buildSessionHeader
};