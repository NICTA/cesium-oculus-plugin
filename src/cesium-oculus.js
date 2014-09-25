var CesiumOculus = (function() {
  "use strict";

  function defaultErrorHandler(msg) {
    alert(msg);
  }

  var CesiumOculus = function(callback, errorHandler) {
    this.errorHandler = typeof errorHandler === 'undefined' ? defaultErrorHandler : errorHandler;
    this.state = undefined;
    this.hmdInfo = undefined;

    this.firstTime = true;
    this.refMtx = new Cesium.Matrix3();

    var that = this;

    that.hmdInfo = {
        "deviceName": "Oculus Rift DK2",
        "deviceManufacturer": "Oculus VR",
        "deviceVersion": 0,
        "desktopX": 0,
        "desktopY": 0,
        "resolutionHorz": 1920,
        "resolutionVert": 1080,
        "screenSizeHorz": 0.14976,
        "screenSizeVert": 0.0936,
        "screenCenterVert": 0.0468,
        "eyeToScreenDistance": 0.041,
        "lensSeparationDistance": 0.0635,
        "interpupillaryDistance": 0.064,
        "distortionK": {
            "0": 1,
            "1": 0.2199999988079071,
            "2": 0.23999999463558197,
            "3": 0
        },
        "chromaAbCorrection": {
            "0": 0.9959999918937683,
            "1": -0.004000000189989805,
            "2": 1.0140000581741333,
            "3": 0
        }
    };
    that.state = vr.createState();
    that.params = {
        "left": getParams(that.hmdInfo, 'left'),
        "right": getParams(that.hmdInfo, 'right')
    };

    vr.wait(function(error) {
      if (typeof (callback) !== 'undefined') {
        callback(that.hmdInfo);
      }
    });
  };

  function getParams(hmd, eye) {
    var result = {};

    result.postProcessFilter = new Cesium.CustomPostProcess(CesiumOculus.getShader(), CesiumOculus.getUniforms(hmd, eye));

    // Calculate offset as per Oculus SDK docs
    var viewCenter = hmd.screenSizeHorz * 0.25;
    var eyeProjectionShift = viewCenter - hmd.lensSeparationDistance * 0.5;
    var projectionCenterOffset = 4.0 * eyeProjectionShift / hmd.screenSizeHorz;
    projectionCenterOffset *= 0.5;
    result.frustumOffset = eye === 'left' ? -projectionCenterOffset : projectionCenterOffset;

    return result;
  }

  CesiumOculus.prototype.setSceneParams = function(scene, eye) {
    switch (eye) {
    case "left":
    case "right":
      var p = this.params[eye];
      scene.customPostProcess = p.postProcessFilter;
      scene.camera.frustum.setOffset(p.frustumOffset, 0.0);
      break;
    default:
      this.errorHandler("developer error, incorrect eye");
    }
  };

  CesiumOculus.prototype.toQuat = function(r) {
    if (r[0] === 0 && r[1] === 0 && r[2] === 0 && r[3] === 0) {
      return Cesium.Quaternion.IDENTITY;
    }
    return new Cesium.Quaternion(r[0], r[1], r[2], r[3]);
  };

  CesiumOculus.prototype.getRotation = function () {      
      vr.poll(this.state)      
      return this.toQuat(this.state.oculus.rotation);
  };

  CesiumOculus.prototype.getPosition = function () {
      vr.poll(this.state)
      return this.toQuat(this.state.oculus.position);
  };

  CesiumOculus.getUniforms = function(hmd, eye) {
    var scale = 2.0;
    var scale2 = 1 / 1.6;
    var aspect = hmd.resolutionHorz / (2 * hmd.resolutionVert);
    var r = -1.0 - (4 * (hmd.screenSizeHorz / 4 - hmd.lensSeparationDistance / 2) / hmd.screenSizeHorz);
    var distScale = (hmd.distortionK[0] + hmd.distortionK[1] * Math.pow(r, 2) + hmd.distortionK[2] * Math.pow(r, 4) + hmd.distortionK[3] * Math.pow(r, 6));
    var lensCenterOffset = 4 * (0.25 * hmd.screenSizeHorz - 0.5 * hmd.lensSeparationDistance) / hmd.screenSizeHorz;
    var uniforms = {
      LensCenter : function() {
        return {
          x : 0.0 + (eye === 'left' ? lensCenterOffset : -lensCenterOffset),
          y : 0.0
        };
      },
      ScreenCenter : function() {
        return {
          x : 0.5,
          y : 0.5
        };
      },
      Scale : function() {
        return {
          x : 1.0 / distScale,
          y : 1.0 * aspect / distScale
        };
      },
      ScaleIn : function() {
        return {
          x : 1.0,
          y : 1.0 / aspect
        };
      },
      HmdWarpParam : function() {
        return {
          x : hmd.distortionK[0],
          y : hmd.distortionK[1],
          z : hmd.distortionK[2],
          w : hmd.distortionK[3]
        };
      },
      ChromAbParam : function() {
        return {
          x : hmd.chromaAbCorrection[0],
          y : hmd.chromaAbCorrection[1],
          z : hmd.chromaAbCorrection[2],
          w : hmd.chromaAbCorrection[3]
        };
      }
    };

    return uniforms;
  };

  CesiumOculus.getShader = function() {
    return [
     "uniform vec2 Scale;",
     "uniform vec2 ScaleIn;",
     "uniform vec2 LensCenter;",
     "uniform vec4 HmdWarpParam;",
     'uniform vec4 ChromAbParam;',
     "uniform sampler2D u_texture;",
     "varying vec2 v_textureCoordinates;",
     "void main()",
     "{",
     "  vec2 uv = (v_textureCoordinates * 2.0) - 1.0;", // range from [0,1] to [-1,1]
     "  vec2 theta = (uv - LensCenter) * ScaleIn;", // Scales to [-1, 1]
     "  float rSq = theta.x * theta.x + theta.y * theta.y;",
     "  vec2 theta1 = theta * (HmdWarpParam.x + HmdWarpParam.y * rSq +",
     "                         HmdWarpParam.z * rSq * rSq +",
     "                         HmdWarpParam.w * rSq * rSq * rSq);",
     // Detect whether blue texture coordinates are out of range
     // since these will scaled out the furthest.
     "  vec2 thetaBlue = theta1 * (ChromAbParam.z + ChromAbParam.w * rSq);",
     "  vec2 tcBlue = LensCenter + Scale * thetaBlue;",
     "  tcBlue = (tcBlue + 1.0) / 2.0;", // range from [-1,1] to [0,1]
     "  if (any(bvec2(clamp(tcBlue, vec2(0.0,0.0), vec2(1.0,1.0))-tcBlue))) {",
     "    gl_FragColor = vec4(0.0, 0.0, 0.0, 1.0);",
     "    return;",
     "  }",
      // Now do blue texture lookup.
     "  float blue = texture2D(u_texture, tcBlue).b;",
      // Do green lookup (no scaling)
     "  vec2 tcGreen = LensCenter + Scale * theta1;",
     "  tcGreen = (tcGreen + 1.0) / 2.0;", // range from [-1,1] to [0,1]
     "  float green = texture2D(u_texture, tcGreen).g;",
     // Do red scale and lookup.
     "  vec2 thetaRed = theta1 * (ChromAbParam.x + ChromAbParam.y * rSq);",
     "  vec2 tcRed = LensCenter + Scale * thetaRed;",
     "  tcRed = (tcRed + 1.0) / 2.0;", // range from [-1,1] to [0,1]
     "  float red = texture2D(u_texture, tcRed).r;",
     "  gl_FragColor = vec4(red, green, blue, 1.0);",
     "}"
   ].join("\n");
  };

  CesiumOculus.slaveCameraUpdate = function(master, eyeOffset, slave) {
    var right = new Cesium.Cartesian3();

    var eye = Cesium.Cartesian3.clone(master.position);
    var target = Cesium.Cartesian3.clone(master.direction);
    var up = Cesium.Cartesian3.clone(master.up);

    Cesium.Cartesian3.cross(master.direction, master.up, right);

    Cesium.Cartesian3.multiplyByScalar(right, eyeOffset, right);
    Cesium.Cartesian3.add(eye, right, eye);

    Cesium.Cartesian3.multiplyByScalar(target, 10000, target);
    Cesium.Cartesian3.add(target, eye, target);

    slave.lookAt(eye, target, up);
  };

  CesiumOculus.prototype.applyOculusTransformation = function(camera, rotation, position) {
      var factor = 5000;


      if (this.lastRotation) {
          camera.look(camera.direction, -this.lastRotation.z * Math.PI);
          camera.lookDown(this.lastRotation.x * Math.PI);
          camera.lookRight(this.lastRotation.y * Math.PI);
      }   

      if (this.lastPosition) {
          camera.moveLeft(this.lastPosition.x * factor);
          camera.moveDown(this.lastPosition.y * factor);
          camera.moveForward(this.lastPosition.z * factor);
      }

      camera.moveBackward(position.z * factor);
      camera.moveUp(position.y * factor);
      camera.moveRight(position.x * factor);

      camera.lookLeft(rotation.y * Math.PI);
      camera.lookUp(rotation.x * Math.PI);
      camera.look(camera.direction, rotation.z * Math.PI);

      this.lastRotation = rotation;
      this.lastPosition = position;
      this.lastDirection = camera.position   
  };

  return CesiumOculus;

}());
