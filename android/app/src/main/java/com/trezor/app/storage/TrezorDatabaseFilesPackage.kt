package com.trezor.app.storage

import com.facebook.react.BaseReactPackage
import com.facebook.react.bridge.NativeModule
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.module.model.ReactModuleInfo
import com.facebook.react.module.model.ReactModuleInfoProvider

class TrezorDatabaseFilesPackage : BaseReactPackage() {

  override fun getModule(name: String, reactContext: ReactApplicationContext): NativeModule? =
      if (name == TrezorDatabaseFilesModule.NAME) TrezorDatabaseFilesModule(reactContext)
      else null

  override fun getReactModuleInfoProvider() = ReactModuleInfoProvider {
    mapOf(
        TrezorDatabaseFilesModule.NAME to
            ReactModuleInfo(
                name = TrezorDatabaseFilesModule.NAME,
                className = TrezorDatabaseFilesModule.NAME,
                canOverrideExistingModule = false,
                needsEagerInit = false,
                isCxxModule = false,
                isTurboModule = true,
            ),
    )
  }
}
