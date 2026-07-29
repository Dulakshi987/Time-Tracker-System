package com.service;

import com.entity.*;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;

import java.io.UnsupportedEncodingException;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.List;
import java.util.Optional;
import com.repository.*;

@Service
public class AdminSetupService {

    @Autowired private StaffMemberRepository staffRepo;
    @Autowired private SystemUserRepository userRepo;
    @Autowired private DivisionRepository divisionRepo;
    @Autowired private PickerRepository pickerRepo;
    @Autowired private PrintOperatorRepository printRepo;
    @Autowired private CheckOperatorRepository checkRepo;
    @Autowired private DeliveryOperatorRepository deliveryRepo;
    @Autowired private FileOperatorRepository fileOperatorRepo;
    @Autowired private JobCategoryRepository jobCategoryRepo;
    @Autowired private FileNumberSetupRepository fileNumberRepo;

    // ── Password hashing (SHA-256) ───────────────────────────────────────
    private String hash(String raw) {
        try {
            MessageDigest md = MessageDigest.getInstance("SHA-256");
            byte[] digest = md.digest(raw.getBytes("UTF-8"));
            StringBuilder sb = new StringBuilder();
            for (byte b : digest) sb.append(String.format("%02x", b));
            return sb.toString();
        } catch (NoSuchAlgorithmException | UnsupportedEncodingException e) {
            throw new RuntimeException("Password hashing failed", e);
        }
    }

    // ── Button 1: Staff Member (user character master) ──────────────────
    public List<StaffMember> getAllStaff() { return staffRepo.findAll(); }
    public StaffMember createStaff(StaffMember s) { return staffRepo.save(s); }
    public StaffMember updateStaff(Long id, StaffMember s) {
        StaffMember existing = staffRepo.findById(id).orElseThrow();
        existing.setName(s.getName());
        return staffRepo.save(existing);
    }
    public void deleteStaff(Long id) { staffRepo.deleteById(id); }

    // ── Button 2: System User / Account ──────────────────────────────────
    public List<SystemUser> getAllUsers() { return userRepo.findAll(); }

    public SystemUser createUser(SystemUser u, String password, String confirmPassword) {
        if (password == null || !password.equals(confirmPassword)) {
            throw new IllegalArgumentException("Password and Confirm Password do not match");
        }
        u.setPasswordHash(hash(password));
        return userRepo.save(u);
    }

    public SystemUser updateUser(Long id, SystemUser u, String password, String confirmPassword) {
        SystemUser existing = userRepo.findById(id).orElseThrow();
        existing.setStaffName(u.getStaffName());
        existing.setFullName(u.getFullName());
        existing.setNic(u.getNic());
        existing.setUsername(u.getUsername());
        existing.setDivisionNo(u.getDivisionNo()); // ← was missing, so edits never persisted the division(s)
        if (password != null && !password.isBlank()) {
            if (!password.equals(confirmPassword)) {
                throw new IllegalArgumentException("Password and Confirm Password do not match");
            }
            existing.setPasswordHash(hash(password));
        }
        return userRepo.save(existing);
    }

    public void deleteUser(Long id) { userRepo.deleteById(id); }

    // Simple "Forgot Password": verify username + NIC match, then set a new password.
    public SystemUser forgotPassword(String username, String nic, String newPassword) {
        SystemUser u = userRepo.findByUsernameAndNic(username, nic);
        if (u == null) throw new IllegalArgumentException("Username / NIC does not match any account");
        u.setPasswordHash(hash(newPassword));
        return userRepo.save(u);
    }

    // ── Division ──────────────────────────────────────────────────────────
    public List<Division> getAllDivisions() { return divisionRepo.findAll(); }
    public Division createDivision(Division d) { return divisionRepo.save(d); }
    public Division updateDivision(Long id, Division d) {
        Division existing = divisionRepo.findById(id).orElseThrow();
        existing.setDivisionName(d.getDivisionName());
        existing.setDivisionNo(d.getDivisionNo());
        existing.setDivisionHead(d.getDivisionHead());
        existing.setEnteredBy(d.getEnteredBy());
        return divisionRepo.save(existing);
    }
    public void deleteDivision(Long id) { divisionRepo.deleteById(id); }

    // ── Picker ──────────────────────────────────────────────────────────
    public List<Picker> getAllPickers() { return pickerRepo.findAll(); }
    public Picker createPicker(Picker p) { return pickerRepo.save(p); }
    public Picker updatePicker(Long id, Picker p) {
        Picker existing = pickerRepo.findById(id).orElseThrow();
        existing.setPickerName(p.getPickerName());
        existing.setNic(p.getNic());
        existing.setPickerNicName(p.getPickerNicName());
        existing.setDivisionNo(p.getDivisionNo());
        return pickerRepo.save(existing);
    }
    public void deletePicker(Long id) { pickerRepo.deleteById(id); }

    // ── Print / Document Operator ────────────────────────────────────────
    public List<PrintOperator> getAllPrintOperators() { return printRepo.findAll(); }
    public PrintOperator createPrintOperator(PrintOperator p) { return printRepo.save(p); }
    public PrintOperator updatePrintOperator(Long id, PrintOperator p) {
        PrintOperator existing = printRepo.findById(id).orElseThrow();
        existing.setOperatorName(p.getOperatorName());
        existing.setNic(p.getNic());
        existing.setOperatorNicName(p.getOperatorNicName());
        existing.setDivisionNo(p.getDivisionNo());
        return printRepo.save(existing);
    }
    public void deletePrintOperator(Long id) { printRepo.deleteById(id); }

    // ── Check Operator ────────────────────────────────────────────────────
    public List<CheckOperator> getAllCheckOperators() { return checkRepo.findAll(); }
    public CheckOperator createCheckOperator(CheckOperator c) { return checkRepo.save(c); }
    public CheckOperator updateCheckOperator(Long id, CheckOperator c) {
        CheckOperator existing = checkRepo.findById(id).orElseThrow();
        existing.setOperatorName(c.getOperatorName());
        existing.setNic(c.getNic());
        existing.setOperatorNicName(c.getOperatorNicName());
        existing.setDivisionNo(c.getDivisionNo());
        return checkRepo.save(existing);
    }
    public void deleteCheckOperator(Long id) { checkRepo.deleteById(id); }

    // ── Delivery Operator ─────────────────────────────────────────────────
    public List<DeliveryOperator> getAllDeliveryOperators() { return deliveryRepo.findAll(); }
    public DeliveryOperator createDeliveryOperator(DeliveryOperator d) { return deliveryRepo.save(d); }
    public DeliveryOperator updateDeliveryOperator(Long id, DeliveryOperator d) {
        DeliveryOperator existing = deliveryRepo.findById(id).orElseThrow();
        existing.setOperatorName(d.getOperatorName());
        existing.setNic(d.getNic());
        existing.setOperatorNicName(d.getOperatorNicName());
        existing.setDivisionNo(d.getDivisionNo());
        return deliveryRepo.save(existing);
    }
    public void deleteDeliveryOperator(Long id) { deliveryRepo.deleteById(id); }

    // ── File (Filing) Operator ───────────────────────────────────────────
    public List<FileOperator> getAllFileOperators() { return fileOperatorRepo.findAll(); }
    public FileOperator createFileOperator(FileOperator f) { return fileOperatorRepo.save(f); }
    public FileOperator updateFileOperator(Long id, FileOperator f) {
        FileOperator existing = fileOperatorRepo.findById(id).orElseThrow();
        existing.setOperatorName(f.getOperatorName());
        existing.setNic(f.getNic());
        existing.setOperatorNicName(f.getOperatorNicName());
        existing.setDivisionNo(f.getDivisionNo());
        return fileOperatorRepo.save(existing);
    }
    public void deleteFileOperator(Long id) { fileOperatorRepo.deleteById(id); }

    // ── Job Category ──────────────────────────────────────────────────────
    public List<JobCategory> getAllJobCategories() { return jobCategoryRepo.findAll(); }
    public JobCategory createJobCategory(JobCategory j) { return jobCategoryRepo.save(j); }
    public JobCategory updateJobCategory(Long id, JobCategory j) {
        JobCategory existing = jobCategoryRepo.findById(id).orElseThrow();
        existing.setCategoryName(j.getCategoryName());
        existing.setDivisionName(j.getDivisionName());
        return jobCategoryRepo.save(existing);
    }
    public void deleteJobCategory(Long id) { jobCategoryRepo.deleteById(id); }

    // ── File Number Setup (only one ACTIVE at a time) ────────────────────
    public List<FileNumberSetup> getAllFileNumbers() { return fileNumberRepo.findAll(); }

    public FileNumberSetup createFileNumber(FileNumberSetup f) {
        if (Boolean.TRUE.equals(f.getActive())) deactivateAllExcept(null);
        return fileNumberRepo.save(f);
    }

    public FileNumberSetup updateFileNumber(Long id, FileNumberSetup f) {
        FileNumberSetup existing = fileNumberRepo.findById(id).orElseThrow();
        existing.setFileNo(f.getFileNo());
        existing.setFromDate(f.getFromDate());
        existing.setToDate(f.getToDate());
        if (Boolean.TRUE.equals(f.getActive()) && !Boolean.TRUE.equals(existing.getActive())) {
            deactivateAllExcept(id);
        }
        existing.setActive(f.getActive());
        return fileNumberRepo.save(existing);
    }

    public void deleteFileNumber(Long id) { fileNumberRepo.deleteById(id); }

    // Activating one File No automatically deactivates every other one —
    // this is what the Filing Portal reads to know which file is "open".
    private void deactivateAllExcept(Long keepId) {
        for (FileNumberSetup f : fileNumberRepo.findAll()) {
            if (keepId != null && f.getId().equals(keepId)) continue;
            if (Boolean.TRUE.equals(f.getActive())) {
                f.setActive(false);
                fileNumberRepo.save(f);
            }
        }
    }

    public Optional<FileNumberSetup> getActiveFileNumber() {
        return fileNumberRepo.findAll().stream()
                .filter(f -> Boolean.TRUE.equals(f.getActive()))
                .findFirst();
    }
}