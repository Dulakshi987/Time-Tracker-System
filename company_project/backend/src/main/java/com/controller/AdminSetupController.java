package com.controller;

import com.entity.*;
import com.service.AdminSetupService;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.web.bind.annotation.*;

import java.util.List;
import java.util.Map;

@RestController
@RequestMapping("/api/admin-setup")
@CrossOrigin(origins = "*")
public class AdminSetupController {

    @Autowired private AdminSetupService service;

    // ── Button 1: Staff Member ──────────────────────────────────────────
    @GetMapping("/staff") public List<StaffMember> getStaff() { return service.getAllStaff(); }
    @PostMapping("/staff") public StaffMember createStaff(@RequestBody StaffMember s) { return service.createStaff(s); }
    @PutMapping("/staff/{id}") public StaffMember updateStaff(@PathVariable Long id, @RequestBody StaffMember s) { return service.updateStaff(id, s); }
    @DeleteMapping("/staff/{id}") public void deleteStaff(@PathVariable Long id) { service.deleteStaff(id); }

    // ── Button 2: System User / Account ──────────────────────────────────
    @GetMapping("/users") public List<SystemUser> getUsers() { return service.getAllUsers(); }

    @PostMapping("/users")
    public SystemUser createUser(@RequestBody Map<String, String> body) {
        SystemUser u = new SystemUser();
        u.setStaffName(body.get("staffName"));
        u.setFullName(body.get("fullName"));
        u.setNic(body.get("nic"));
        u.setUsername(body.get("username"));
        u.setCreatedBy(body.get("createdBy"));
        return service.createUser(u, body.get("password"), body.get("confirmPassword"));
    }

    @PutMapping("/users/{id}")
    public SystemUser updateUser(@PathVariable Long id, @RequestBody Map<String, String> body) {
        SystemUser u = new SystemUser();
        u.setStaffName(body.get("staffName"));
        u.setFullName(body.get("fullName"));
        u.setNic(body.get("nic"));
        u.setUsername(body.get("username"));
        return service.updateUser(id, u, body.get("password"), body.get("confirmPassword"));
    }

    @DeleteMapping("/users/{id}") public void deleteUser(@PathVariable Long id) { service.deleteUser(id); }

    @PostMapping("/users/forgot-password")
    public SystemUser forgotPassword(@RequestBody Map<String, String> body) {
        return service.forgotPassword(body.get("username"), body.get("nic"), body.get("newPassword"));
    }

    // ── Division ──────────────────────────────────────────────────────────
    @GetMapping("/divisions") public List<Division> getDivisions() { return service.getAllDivisions(); }
    @PostMapping("/divisions") public Division createDivision(@RequestBody Division d) { return service.createDivision(d); }
    @PutMapping("/divisions/{id}") public Division updateDivision(@PathVariable Long id, @RequestBody Division d) { return service.updateDivision(id, d); }
    @DeleteMapping("/divisions/{id}") public void deleteDivision(@PathVariable Long id) { service.deleteDivision(id); }

    // ── Picker ──────────────────────────────────────────────────────────
    @GetMapping("/pickers") public List<Picker> getPickers() { return service.getAllPickers(); }
    @PostMapping("/pickers") public Picker createPicker(@RequestBody Picker p) { return service.createPicker(p); }
    @PutMapping("/pickers/{id}") public Picker updatePicker(@PathVariable Long id, @RequestBody Picker p) { return service.updatePicker(id, p); }
    @DeleteMapping("/pickers/{id}") public void deletePicker(@PathVariable Long id) { service.deletePicker(id); }

    // ── Print / Document Operator ────────────────────────────────────────
    @GetMapping("/print-operators") public List<PrintOperator> getPrintOperators() { return service.getAllPrintOperators(); }
    @PostMapping("/print-operators") public PrintOperator createPrintOperator(@RequestBody PrintOperator p) { return service.createPrintOperator(p); }
    @PutMapping("/print-operators/{id}") public PrintOperator updatePrintOperator(@PathVariable Long id, @RequestBody PrintOperator p) { return service.updatePrintOperator(id, p); }
    @DeleteMapping("/print-operators/{id}") public void deletePrintOperator(@PathVariable Long id) { service.deletePrintOperator(id); }

    // ── Check Operator ────────────────────────────────────────────────────
    @GetMapping("/check-operators") public List<CheckOperator> getCheckOperators() { return service.getAllCheckOperators(); }
    @PostMapping("/check-operators") public CheckOperator createCheckOperator(@RequestBody CheckOperator c) { return service.createCheckOperator(c); }
    @PutMapping("/check-operators/{id}") public CheckOperator updateCheckOperator(@PathVariable Long id, @RequestBody CheckOperator c) { return service.updateCheckOperator(id, c); }
    @DeleteMapping("/check-operators/{id}") public void deleteCheckOperator(@PathVariable Long id) { service.deleteCheckOperator(id); }

    // ── Delivery Operator ─────────────────────────────────────────────────
    @GetMapping("/delivery-operators") public List<DeliveryOperator> getDeliveryOperators() { return service.getAllDeliveryOperators(); }
    @PostMapping("/delivery-operators") public DeliveryOperator createDeliveryOperator(@RequestBody DeliveryOperator d) { return service.createDeliveryOperator(d); }
    @PutMapping("/delivery-operators/{id}") public DeliveryOperator updateDeliveryOperator(@PathVariable Long id, @RequestBody DeliveryOperator d) { return service.updateDeliveryOperator(id, d); }
    @DeleteMapping("/delivery-operators/{id}") public void deleteDeliveryOperator(@PathVariable Long id) { service.deleteDeliveryOperator(id); }

    // ── File (Filing) Operator ───────────────────────────────────────────
    @GetMapping("/file-operators") public List<FileOperator> getFileOperators() { return service.getAllFileOperators(); }
    @PostMapping("/file-operators") public FileOperator createFileOperator(@RequestBody FileOperator f) { return service.createFileOperator(f); }
    @PutMapping("/file-operators/{id}") public FileOperator updateFileOperator(@PathVariable Long id, @RequestBody FileOperator f) { return service.updateFileOperator(id, f); }
    @DeleteMapping("/file-operators/{id}") public void deleteFileOperator(@PathVariable Long id) { service.deleteFileOperator(id); }

    // ── Job Category ──────────────────────────────────────────────────────
    @GetMapping("/job-categories") public List<JobCategory> getJobCategories() { return service.getAllJobCategories(); }
    @PostMapping("/job-categories") public JobCategory createJobCategory(@RequestBody JobCategory j) { return service.createJobCategory(j); }
    @PutMapping("/job-categories/{id}") public JobCategory updateJobCategory(@PathVariable Long id, @RequestBody JobCategory j) { return service.updateJobCategory(id, j); }
    @DeleteMapping("/job-categories/{id}") public void deleteJobCategory(@PathVariable Long id) { service.deleteJobCategory(id); }

    // ── File Number Setup ─────────────────────────────────────────────────
    @GetMapping("/file-numbers") public List<FileNumberSetup> getFileNumbers() { return service.getAllFileNumbers(); }
    @GetMapping("/file-numbers/active") public FileNumberSetup getActiveFileNumber() { return service.getActiveFileNumber().orElse(null); }
    @PostMapping("/file-numbers") public FileNumberSetup createFileNumber(@RequestBody FileNumberSetup f) { return service.createFileNumber(f); }
    @PutMapping("/file-numbers/{id}") public FileNumberSetup updateFileNumber(@PathVariable Long id, @RequestBody FileNumberSetup f) { return service.updateFileNumber(id, f); }
    @DeleteMapping("/file-numbers/{id}") public void deleteFileNumber(@PathVariable Long id) { service.deleteFileNumber(id); }
}