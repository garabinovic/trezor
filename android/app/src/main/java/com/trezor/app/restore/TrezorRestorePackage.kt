package com.trezor.app.restore

import com.facebook.react.BaseReactPackage
import com.facebook.react.bridge.NativeModule
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.module.model.ReactModuleInfo
import com.facebook.react.module.model.ReactModuleInfoProvider

class TrezorRestorePackage : BaseReactPackage() {

  override fun getModule(name: String, reactContext: ReactApplicationContext): NativeModule? =
      if (name == TrezorRestoreModule.NAME) TrezorRestoreModule(reactContext) else null

  override fun getReactModuleInfoProvider() = ReactModuleInfoProvider {
    mapOf(
        TrezorRestoreModule.NAME to
            ReactModuleInfo(
                name = TrezorRestoreModule.NAME,
                className = TrezorRestoreModule.NAME,
                canOverrideExistingModule = false,
                needsEagerInit = false,
                isCxxModule = false,
                isTurboModule = true,
            ),
    )
  }
}
