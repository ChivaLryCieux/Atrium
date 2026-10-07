#[cfg(target_os = "windows")]
pub mod job {
    //! Windows Job Object wrapper: every process the bridge spawns (dsh
    //! runtimes) joins the job, and terminating/closing the job kills the
    //! whole tree — `Child::kill` alone would orphan the grandchildren.

    use std::os::windows::io::AsRawHandle;
    use std::process::Child;

    use windows_sys::Win32::Foundation::{CloseHandle, HANDLE};
    use windows_sys::Win32::System::JobObjects::{
        AssignProcessToJobObject, CreateJobObjectW, JobObjectExtendedLimitInformation,
        JOBOBJECT_EXTENDED_LIMIT_INFORMATION, JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE,
        SetInformationJobObject, TerminateJobObject,
    };

    pub struct JobGuard {
        handle: HANDLE,
    }

    // A HANDLE is a kernel integer handle, not a pointer into process memory:
    // moving or sharing it across threads is sound.
    unsafe impl Send for JobGuard {}
    unsafe impl Sync for JobGuard {}

    impl JobGuard {
        /// Create a kill-on-close job and assign `child` to it. Returns None
        /// when the OS refuses (the child then lives outside the job and is
        /// cleaned up by the plain `Child::kill` fallback).
        pub fn assign(child: &Child) -> Option<Self> {
            unsafe {
                let handle = CreateJobObjectW(std::ptr::null(), std::ptr::null());
                if (handle as isize) == 0 {
                    return None;
                }
                let mut info: JOBOBJECT_EXTENDED_LIMIT_INFORMATION = std::mem::zeroed();
                info.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
                if SetInformationJobObject(
                    handle,
                    JobObjectExtendedLimitInformation,
                    &info as *const _ as *const core::ffi::c_void,
                    std::mem::size_of::<JOBOBJECT_EXTENDED_LIMIT_INFORMATION>() as u32,
                ) == 0
                {
                    CloseHandle(handle);
                    return None;
                }
                let raw = child.as_raw_handle();
                if AssignProcessToJobObject(handle, raw as _) == 0 {
                    CloseHandle(handle);
                    return None;
                }
                Some(Self { handle })
            }
        }

        pub fn terminate(&self) {
            unsafe {
                TerminateJobObject(self.handle, 0);
            }
        }
    }

    impl Drop for JobGuard {
        fn drop(&mut self) {
            // The last closed job handle kills any surviving job members.
            unsafe {
                CloseHandle(self.handle);
            }
        }
    }
}
